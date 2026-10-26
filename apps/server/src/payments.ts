import { errorSummary, trail } from './checkout-log.js';
import type { Capture, CaptureResult, Payment } from './models.js';
import type {
  CheckoutReminderMail,
  PremiumReminderMail,
  PremiumWelcome,
} from './mail.js';
import { planOfOrder, termLabel, PLAN_IDS, type PlanId } from './plans.js';
import type { Store } from './store.js';

type Log = {
  info: (context: object, message: string) => void;
  warn: (context: object, message: string) => void;
  error: (context: object, message: string) => void;
};

export type ApplyDeps = {
  store: Store;
  /** Days a one-month order from before the plans buys. */
  passDays: number;
  appUrl: string;
  log: Log;
  /** Sends the thank-you email; undefined when mail isn't set up. */
  welcome: ((to: string, welcome: PremiumWelcome) => Promise<void>) | undefined;
  /** Runs work after the response without holding it up; must not throw. */
  background: (task: Promise<void>) => void;
};

/**
 * Applies a captured payment, from whichever path reported it first. Only the
 * call that applied it sends the thank-you email, so checkout, the webhook and
 * their retries together send it once. A mail failure never touches the
 * payment.
 */
export async function applyPayment(
  capture: Capture,
  deps: ApplyDeps,
): Promise<CaptureResult> {
  const { store, log } = deps;
  const result = await store.recordPayment(capture, deps.passDays);
  const context = {
    ...capture,
    outcome: result.outcome,
    ...('userId' in result ? { userId: result.userId } : {}),
  };
  if (result.outcome === 'extra')
    trail(
      log,
      'payment.extra',
      context,
      'Extra payment on an order already paid: refund it',
      'warn',
    );
  else if (result.outcome === 'mismatch')
    trail(
      log,
      'payment.mismatch',
      context,
      'Captured amount differs from the order',
      'error',
    );
  else if (result.outcome === 'unknown')
    trail(
      log,
      'payment.unknown_order',
      context,
      'A payment arrived for an order we have no record of',
      'error',
    );
  else if (result.outcome === 'repeat')
    trail(log, 'payment.repeat', context, 'Payment already applied');
  else if (result.outcome === 'applied') {
    trail(
      log,
      'payment.applied',
      { ...context, paidUntil: result.paidUntil },
      'Payment applied',
    );
    const send = deps.welcome;
    if (send)
      deps.background(
        (async () => {
          const [account, order] = await Promise.all([
            store.getAccount(result.userId),
            store.getPayment(capture.orderId),
          ]);
          if (!account?.email || !order) return;
          const plan = planOfOrder(order);
          await send(account.email, {
            name: account.name,
            term: plan ? termLabel(plan) : '1 month',
            amount: order.amount,
            currency: order.currency,
            paymentId: capture.paymentId,
            paidUntil: result.paidUntil,
            appUrl: deps.appUrl,
          });
          trail(
            log,
            'email.welcome_sent',
            context,
            'Premium welcome email sent',
          );
        })().catch((error: unknown) =>
          trail(
            log,
            'email.welcome_failed',
            { ...context, ...errorSummary(error) },
            'Premium welcome email failed',
            'error',
          ),
        ),
      );
  }
  return result;
}

/** Days before Premium ends that the renewal reminder goes out. */
export const REMIND_WITHIN_DAYS = 5;

export type ReminderDeps = {
  store: Store;
  appUrl: string;
  log: Log;
  remind: (to: string, reminder: PremiumReminderMail) => Promise<void>;
  /** Most reminders one run sends; the next run picks up the rest. */
  limit?: number;
};

/**
 * Emails everyone whose Premium ends within `REMIND_WITHIN_DAYS`, once per
 * end date. Each account is marked before its email goes out, so overlapping
 * runs never send twice; a failed send is unmarked to retry on the next run.
 */
export async function sendRenewalReminders(deps: ReminderDeps) {
  const { store, log } = deps;
  const due = await store.claimPremiumReminders(
    REMIND_WITHIN_DAYS,
    deps.limit ?? 100,
  );
  let sent = 0;
  let failed = 0;
  for (const reminder of due) {
    try {
      await deps.remind(reminder.email, {
        name: reminder.name,
        paidUntil: reminder.paidUntil,
        appUrl: deps.appUrl,
      });
      sent++;
    } catch (error) {
      failed++;
      log.error(
        { userId: reminder.userId, error },
        'Premium reminder email failed',
      );
      await store
        .releasePremiumReminder(reminder.userId, reminder.paidUntil)
        .catch((releaseError: unknown) =>
          log.error(
            { userId: reminder.userId, error: releaseError },
            'Could not unmark a failed Premium reminder',
          ),
        );
    }
  }
  return { due: due.length, sent, failed };
}

/** Unpaid checkout emails become due one day after order creation. */
export const CHECKOUT_REMINDER_AFTER_HOURS = 24;
/**
 * ...and stop being due as the order expires (48 hours), with a few hours'
 * slack because a daily cron can fire up to an hour late. Older orders never
 * get a reminder, so nobody is emailed about a checkout from last week.
 */
export const CHECKOUT_REMINDER_UNTIL_HOURS = 54;

export type CheckoutReminderDeps = {
  store: Store;
  appUrl: string;
  log: Log;
  remind: (to: string, reminder: CheckoutReminderMail) => Promise<void>;
  limit?: number;
};

/**
 * Sends one recovery email for the newest overdue checkout per account, and
 * coalesces its older unpaid orders. Claims prevent concurrent cron runs from
 * duplicating emails; failures release the claim for a retry. Verification is
 * intentionally not a filter.
 */
export async function sendCheckoutReminders(deps: CheckoutReminderDeps) {
  const { store, log } = deps;
  const due = await store.claimCheckoutReminders(
    CHECKOUT_REMINDER_AFTER_HOURS,
    deps.limit ?? 100,
    CHECKOUT_REMINDER_UNTIL_HOURS,
  );
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const reminder of due) {
    try {
      const [payment, account] = await Promise.all([
        store.getPayment(reminder.orderId),
        store.getAccount(reminder.userId),
      ]);
      // A webhook or a new account state may have changed after the claim.
      if (!payment || payment.status !== 'created' || !account?.email) {
        skipped++;
        await store.releaseCheckoutReminder(reminder.orderId);
        continue;
      }
      // Already Premium (paid another way, or granted): never nudge them, and
      // settle the order so it isn't claimed again tomorrow.
      if (account.paidUntil && Date.parse(account.paidUntil) > Date.now()) {
        skipped++;
        await store.markCheckoutReminderSent(reminder.orderId);
        continue;
      }

      const plan: PlanId = PLAN_IDS.some((id) => id === payment.plan)
        ? (payment.plan as PlanId)
        : 'quarterly';
      const checkout = new URL('/login', deps.appUrl);
      checkout.searchParams.set('next', `/dashboard?upgrade=${plan}`);
      await deps.remind(account.email, {
        name: account.name,
        checkoutUrl: checkout.toString(),
      });
      await store.markCheckoutReminderSent(reminder.orderId);
      sent++;
    } catch (error) {
      failed++;
      log.error(
        { orderId: reminder.orderId, userId: reminder.userId, error },
        'Checkout reminder email failed',
      );
      await store
        .releaseCheckoutReminder(reminder.orderId)
        .catch((releaseError: unknown) =>
          log.error(
            {
              orderId: reminder.orderId,
              userId: reminder.userId,
              error: releaseError,
            },
            'Could not unclaim a failed checkout reminder',
          ),
        );
    }
  }
  return { due: due.length, sent, failed, skipped };
}

/** Unpaid orders older than this are checked with the provider and expired. */
export const EXPIRE_AFTER_HOURS = 48;
/** Expired orders are deleted this many days after they expired. */
export const PURGE_EXPIRED_AFTER_DAYS = 90;

/** What the provider says about an unpaid order. */
export type OrderCheck =
  | { state: 'paid'; capture: Capture }
  /** Paid, but the provider didn't give us the payment to apply. */
  | { state: 'paid_unreadable' }
  | { state: 'unpaid'; detail?: string }
  /** We couldn't ask (no keys, or the provider didn't answer). */
  | { state: 'unknown'; error: unknown };

export type ExpireDeps = {
  store: Store;
  log: Log;
  check: (order: Payment) => Promise<OrderCheck>;
  apply: (capture: Capture) => Promise<CaptureResult>;
  limit?: number;
};

/** Why an unpaid order ended, for the order's failure_reason. */
function expiryReason(order: Payment, detail?: string) {
  const last = order.lastEvent
    ? `last event: ${order.lastEvent}`
    : "no event from the buyer's browser";
  const failure = order.failureReason ? `; ${order.failureReason}` : '';
  return `Unpaid after ${EXPIRE_AFTER_HOURS} hours (${last}${failure})${detail ? `; provider: ${detail}` : ''}`.slice(
    0,
    500,
  );
}

/**
 * Settles orders nobody paid. Each one is first checked with its provider, so
 * a payment whose confirmation never reached us is applied rather than lost.
 * Unpaid ones become `expired` (a payment that still arrives later is applied
 * all the same); expired orders are deleted after PURGE_EXPIRED_AFTER_DAYS.
 */
export async function expireStaleOrders(deps: ExpireDeps) {
  const { store, log } = deps;
  const stale = await store.listStaleOrders(
    EXPIRE_AFTER_HOURS,
    deps.limit ?? 50,
  );
  let recovered = 0;
  let expired = 0;
  let skipped = 0;
  for (const order of stale) {
    const context = {
      orderId: order.orderId,
      userId: order.userId,
      provider: order.provider ?? 'razorpay',
      amount: order.amount,
      currency: order.currency,
      createdAt: order.createdAt,
      ...(order.lastEvent ? { lastEvent: order.lastEvent } : {}),
    };
    try {
      const found = await deps.check(order);
      if (found.state === 'paid') {
        const result = await deps.apply(found.capture);
        trail(
          log,
          'expire.recovered',
          { ...context, outcome: result.outcome },
          'An unpaid-looking order was paid at the provider; applied it',
          'warn',
        );
        recovered++;
        continue;
      }
      if (found.state === 'paid_unreadable') {
        trail(
          log,
          'expire.check_failed',
          context,
          'The provider says this order is paid but returned no capture; left for review',
          'error',
        );
        skipped++;
        continue;
      }
      if (found.state === 'unknown') {
        // We expire it anyway: a payment that arrives later still applies.
        trail(
          log,
          'expire.check_failed',
          { ...context, ...errorSummary(found.error) },
          'Could not check an unpaid order with its provider; expiring it',
          'warn',
        );
      }
      const reason = expiryReason(
        order,
        found.state === 'unpaid' ? found.detail : 'not checked',
      );
      if (await store.expireOrder(order.orderId, reason)) {
        trail(
          log,
          'expire.expired',
          { ...context, reason },
          'Unpaid order expired',
        );
        expired++;
      } else skipped++;
    } catch (error) {
      skipped++;
      trail(
        log,
        'expire.check_failed',
        { ...context, ...errorSummary(error) },
        'Expiring an unpaid order failed; the next run retries it',
        'error',
      );
    }
  }
  const purged = await store.purgeExpiredOrders(PURGE_EXPIRED_AFTER_DAYS);
  if (purged)
    trail(log, 'expire.purged', { purged }, 'Old expired orders deleted');
  return { checked: stale.length, recovered, expired, skipped, purged };
}
