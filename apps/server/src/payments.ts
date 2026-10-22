import type { Capture, CaptureResult } from './models.js';
import type { PremiumWelcome } from './mail.js';
import type { Store } from './store.js';

type Log = {
  info: (context: object, message: string) => void;
  warn: (context: object, message: string) => void;
  error: (context: object, message: string) => void;
};

export type ApplyDeps = {
  store: Store;
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
          await send(account.email, {
            name: account.name,
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
