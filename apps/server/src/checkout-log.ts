/**
 * One log line per step of a checkout, so a payment can be followed end to
 * end in the Vercel logs. Every line carries `checkout: <step>` and, once an
 * order exists, `orderId`; search either to see an order's whole story:
 *
 *   order.created → client.opened → client.failed / client.dismissed
 *   → verify.received → payment.applied → email.welcome_sent
 *
 * or, for an order nobody paid, → expire.expired a couple of days later.
 * Warnings and errors mark the step where things went wrong.
 */

export type CheckoutStep =
  // Starting a checkout
  | 'order.requested'
  | 'order.reused'
  | 'order.recovered'
  | 'order.created'
  | 'order.create_failed'
  | 'order.check_failed'
  // What the buyer's browser reported
  | 'client.opened'
  | 'client.dismissed'
  | 'client.failed'
  | 'client.error'
  | 'client.pending'
  | 'client.unknown_order'
  // Our confirmation of a payment
  | 'verify.received'
  | 'verify.unknown_order'
  | 'verify.bad_signature'
  | 'paypal.capture_failed'
  | 'paypal.declined'
  | 'paypal.pending'
  | 'paypal.not_completed'
  // Webhooks from the providers
  | 'webhook.received'
  | 'webhook.rejected'
  | 'webhook.ignored'
  // Applying the money
  | 'payment.applied'
  | 'payment.repeat'
  | 'payment.extra'
  | 'payment.mismatch'
  | 'payment.unknown_order'
  | 'refund.applied'
  | 'refund.partial'
  | 'refund.ignored'
  | 'email.welcome_sent'
  | 'email.welcome_failed'
  // The daily clean-up of unpaid orders
  | 'expire.recovered'
  | 'expire.expired'
  | 'expire.check_failed'
  | 'expire.purged';

type Level = 'info' | 'warn' | 'error';

export type TrailLog = Record<
  Level,
  (context: object, message: string) => void
>;

/** Logs one checkout step with its context. */
export function trail(
  log: TrailLog,
  step: CheckoutStep,
  context: Record<string, unknown>,
  message: string,
  level: Level = 'info',
) {
  log[level]({ checkout: step, ...context }, message);
}

/** The useful part of an error for a log line, without a stack trace. */
export function errorSummary(error: unknown) {
  if (!(error instanceof Error)) return { error: String(error) };
  const extra = error as Error & { status?: number; issue?: string };
  return {
    error: error.message,
    ...(extra.status !== undefined ? { errorStatus: extra.status } : {}),
    ...(extra.issue ? { errorIssue: extra.issue } : {}),
  };
}
