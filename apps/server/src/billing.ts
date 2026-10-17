import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from './config.js';

const ORDERS_URL = 'https://api.razorpay.com/v1/orders';

export const billingConfigured = () => Boolean(config.razorpay);

export type Price = {
  name: string;
  currency: 'INR' | 'USD';
  amount: number;
  listAmount: number;
  days: number;
  interval: 'month';
};

/**
 * Premium for one month. Visitors in India pay in rupees and everyone else in
 * dollars, going by the country Vercel's edge sets on each request.
 */
export function priceFor(country: string | undefined): Price {
  const currency = country?.toUpperCase() === 'IN' ? 'INR' : 'USD';
  return {
    name: 'CanvaRoom Premium · 1 month',
    currency,
    ...config.prices[currency],
    days: config.passDays,
    interval: 'month',
  };
}

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
 * Creates an order for the pass. The amount always comes from server config,
 * never from the browser.
 */
export async function createOrder(
  receipt: string,
  userId: string,
  price: Price,
) {
  const keys = config.razorpay;
  if (!keys) throw new RazorpayError('Payments are not configured.', 503);
  const { amount, currency } = price;
  const response = await fetch(ORDERS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${keys.keyId}:${keys.keySecret}`).toString('base64')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ amount, currency, receipt, notes: { userId } }),
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

/** Checks Razorpay's `HMAC-SHA256(order_id|payment_id)` payment signature. */
export function validPaymentSignature(
  orderId: string,
  paymentId: string,
  signature: string,
) {
  const keys = config.razorpay;
  if (!keys) return false;
  const expected = createHmac('sha256', keys.keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest();
  const given = Buffer.from(signature, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}
