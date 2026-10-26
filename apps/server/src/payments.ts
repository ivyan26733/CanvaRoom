import type { Capture, CaptureResult } from './models.js';
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
  const context = { ...capture, outcome: result.outcome };
  if (result.outcome === 'extra')
    log.warn(context, 'Extra payment on an order already paid: refund it');
  else if (result.outcome === 'mismatch')
    log.error(context, 'Captured amount differs from the order');
  else if (result.outcome === 'applied') {
    log.info(context, 'Payment applied');
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
        })().catch((error: unknown) =>
          log.error({ ...context, error }, 'Premium welcome email failed'),
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
