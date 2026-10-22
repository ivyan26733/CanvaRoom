import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { config } from './config.js';
import type { Capture } from './models.js';
import type { PremiumPlan } from './plans.js';

const ORDERS_URL = 'https://api.razorpay.com/v1/orders';

const basicAuth = (keys: { keyId: string; keySecret: string }) =>
  `Basic ${Buffer.from(`${keys.keyId}:${keys.keySecret}`).toString('base64')}`;

export const billingConfigured = () => Boolean(config.razorpay);

/** Razorpay refused the request; `status` is its HTTP status. */
export class RazorpayError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * Creates an order for a plan. The amount always comes from the server's
 * plan table, never from the browser.
 */
export async function createOrder(
  receipt: string,
  userId: string,
  plan: PremiumPlan,
) {
  const keys = config.razorpay;
  if (!keys) throw new RazorpayError('Payments are not configured.', 503);
  const { amount, currency } = plan;
  const response = await fetch(ORDERS_URL, {
    method: 'POST',
    headers: {
      Authorization: basicAuth(keys),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount,
      currency,
      receipt,
      notes: { userId, plan: plan.id },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await response.json().catch(() => ({}))) as {
    id?: string;
    amount?: number;
    currency?: string;
    error?: { description?: string };
  };
  if (!response.ok || !body.id)
    throw new RazorpayError(
      body.error?.description ?? `Razorpay returned ${response.status}.`,
      response.status,
    );
  return {
    orderId: body.id,
    amount: body.amount ?? amount,
    currency: body.currency ?? currency,
  };
}

/** Whether `signature` is the hex HMAC-SHA256 of `data` under `secret`. */
function signedBy(secret: string, data: string | Buffer, signature: string) {
  const expected = createHmac('sha256', secret).update(data).digest();
  const given = /^[0-9a-f]{64}$/i.test(signature)
    ? Buffer.from(signature, 'hex')
    : Buffer.alloc(0);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Checks Razorpay's `HMAC-SHA256(order_id|payment_id)` payment signature. */
export function validPaymentSignature(
  orderId: string,
  paymentId: string,
  signature: string,
) {
  const keys = config.razorpay;
  return (
    Boolean(keys) &&
    signedBy(keys!.keySecret, `${orderId}|${paymentId}`, signature)
  );
}

/**
 * Checks a webhook's `X-Razorpay-Signature`, which signs the exact bytes
 * Razorpay sent, so it must be checked before the body is parsed.
 */
export function validWebhookSignature(body: Buffer, signature: string) {
  const secret = config.razorpayWebhookSecret;
  return Boolean(secret) && signedBy(secret!, body, signature);
}

export const ORDER_ID = /^order_[A-Za-z0-9]{6,40}$/;
export const PAYMENT_ID = /^pay_[A-Za-z0-9]{6,40}$/;

const paymentEntity = z.object({
  id: z.string().regex(PAYMENT_ID),
  order_id: z.string().regex(ORDER_ID),
  amount: z.number().int().positive(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  status: z.string(),
});

const webhookSchema = z.object({
  event: z.string(),
  payload: z
    .object({
      payment: z.object({ entity: paymentEntity }).optional(),
    })
    .optional(),
});

/**
 * The captured payment a webhook reports, from `payment.captured` or
 * `order.paid`. Other events, and payments not yet captured, give undefined.
 */
export function webhookCapture(body: unknown): Capture | undefined {
  const parsed = webhookSchema.safeParse(body);
  if (!parsed.success) return;
  const { event, payload } = parsed.data;
  const payment = payload?.payment?.entity;
  if (
    (event !== 'payment.captured' && event !== 'order.paid') ||
    payment?.status !== 'captured'
  )
    return;
  return {
    orderId: payment.order_id,
    paymentId: payment.id,
    source: 'webhook',
    amount: payment.amount,
    currency: payment.currency,
  };
}

/**
 * Asks Razorpay whether an order was paid, and by which captured payment.
 * Used before reusing an order, so a payment whose confirmation never reached
 * us (a closed tab, no webhook) is applied instead of being charged again.
 */
export async function orderCapture(
  orderId: string,
): Promise<{ paid: boolean; capture?: Capture }> {
  const keys = config.razorpay;
  if (!keys) throw new RazorpayError('Payments are not configured.', 503);
  const get = async (path: string) => {
    const response = await fetch(`${ORDERS_URL}/${orderId}${path}`, {
      headers: { Authorization: basicAuth(keys) },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok)
      throw new RazorpayError(
        `Razorpay returned ${response.status}.`,
        response.status,
      );
    return response.json() as Promise<unknown>;
  };
  const order = z.object({ status: z.string() }).parse(await get(''));
  if (order.status !== 'paid') return { paid: false };
  const { items } = z
    .object({ items: z.array(paymentEntity) })
    .parse(await get('/payments'));
  const payment = items.find(
    (item) => item.status === 'captured' && item.order_id === orderId,
  );
  return {
    paid: true,
    ...(payment
      ? {
          capture: {
            orderId,
            paymentId: payment.id,
            source: 'reconcile' as const,
            amount: payment.amount,
            currency: payment.currency,
          },
        }
      : {}),
  };
}
