import { z } from 'zod';
import { config } from './config.js';
import type { Capture } from './models.js';
import type { PremiumPlan } from './plans.js';

/**
 * PayPal Checkout through PayPal's REST API (Orders v2), for buyers outside
 * India. The client secret never leaves the server; the client ID is public.
 * `PAYPAL_MODE` picks the sandbox or live keys and API.
 */

const API_BASE = {
  sandbox: 'https://api-m.sandbox.paypal.com',
  live: 'https://api-m.paypal.com',
} as const;

const apiBase = (paypal: {
  mode: 'sandbox' | 'live';
  apiUrl?: string | undefined;
}) => paypal.apiUrl ?? API_BASE[paypal.mode];

/** PayPal's order and capture IDs: 17 or so capitals and digits. */
export const PAYPAL_ID = /^[A-Z0-9]{10,32}$/;

/** PayPal refused or failed a request; `status` is its HTTP status. */
export class PayPalError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly issue?: string,
  ) {
    super(message);
  }
}

export const paypalConfigured = () => Boolean(config.paypal);

/**
 * Whether this account may pay with PayPal. In sandbox mode only the testers
 * listed in PAYPAL_SANDBOX_TESTERS can, so test money never buys real
 * Premium for anyone else.
 */
export function paypalAllowedFor(email: string | undefined) {
  const paypal = config.paypal;
  if (!paypal) return false;
  if (paypal.mode === 'live') return true;
  return Boolean(email) && paypal.testers.has(email!.trim().toLowerCase());
}

let token: { value: string; expires: number; mode: string } | undefined;

/** An OAuth access token, reused until shortly before it expires. */
async function accessToken() {
  const paypal = config.paypal;
  if (!paypal) throw new PayPalError('PayPal is not configured.', 503);
  if (token && token.mode === paypal.mode && token.expires > Date.now())
    return token.value;
  const response = await fetch(`${apiBase(paypal)}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${paypal.clientId}:${paypal.clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!response.ok || !body.access_token)
    throw new PayPalError(
      `PayPal sign-in failed with ${response.status}.`,
      response.status === 401 ? 401 : 502,
    );
  token = {
    value: body.access_token,
    // A minute early, so a token never expires mid-request.
    expires: Date.now() + Math.max(0, (body.expires_in ?? 300) - 60) * 1000,
    mode: paypal.mode,
  };
  return token.value;
}

/** Calls PayPal's API with a fresh token, and parses the JSON reply. */
async function call(
  path: string,
  init: { method?: string; body?: unknown; requestId?: string } = {},
) {
  const paypal = config.paypal;
  if (!paypal) throw new PayPalError('PayPal is not configured.', 503);
  const response = await fetch(`${apiBase(paypal)}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(init.requestId ? { 'PayPal-Request-Id': init.requestId } : {}),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await response.json().catch(() => ({}))) as {
    message?: string;
    details?: { issue?: string; description?: string }[];
  };
  if (!response.ok) {
    const issue = body.details?.[0]?.issue;
    throw new PayPalError(
      body.details?.[0]?.description ??
        body.message ??
        `PayPal returned ${response.status}.`,
      response.status,
      issue,
    );
  }
  return body as unknown;
}

/** "20.00" for 2000 cents. */
export const toDecimal = (minor: number) => (minor / 100).toFixed(2);

/** 2000 for "20.00", or NaN for anything that isn't a plain amount. */
export function toMinor(value: string) {
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) return Number.NaN;
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
}

const money = z.object({ currency_code: z.string(), value: z.string() });

const captureSchema = z.object({
  id: z.string().regex(PAYPAL_ID),
  status: z.string(),
  amount: money,
  custom_id: z.string().optional(),
  supplementary_data: z
    .object({
      related_ids: z.object({ order_id: z.string().optional() }).optional(),
    })
    .optional(),
});
type CaptureEntity = z.infer<typeof captureSchema>;

const orderSchema = z.object({
  id: z.string().regex(PAYPAL_ID),
  status: z.string(),
  purchase_units: z
    .array(
      z.object({
        custom_id: z.string().optional(),
        payments: z
          .object({ captures: z.array(captureSchema).optional() })
          .optional(),
      }),
    )
    .optional(),
});
export type PayPalOrder = z.infer<typeof orderSchema>;

/**
 * Creates a PayPal order for a plan. The amount comes from the server's plan
 * table, and `reference` (our account ID) is kept on the order so the
 * webhook can be traced back.
 */
export async function createPayPalOrder(plan: PremiumPlan, reference: string) {
  const order = orderSchema.parse(
    await call('/v2/checkout/orders', {
      method: 'POST',
      body: {
        intent: 'CAPTURE',
        purchase_units: [
          {
            description: plan.name,
            custom_id: reference.slice(0, 127),
            soft_descriptor: 'CANVAROOM',
            amount: {
              currency_code: plan.currency,
              value: toDecimal(plan.amount),
            },
          },
        ],
        // Applies whichever button the buyer picks (PayPal or a card),
        // unlike payment_source.paypal.experience_context.
        application_context: {
          brand_name: 'Avenor',
          shipping_preference: 'NO_SHIPPING',
          user_action: 'PAY_NOW',
        },
      },
    }),
  );
  return { orderId: order.id, amount: plan.amount, currency: plan.currency };
}

export async function getPayPalOrder(orderId: string) {
  return orderSchema.parse(await call(`/v2/checkout/orders/${orderId}`));
}

/** The order's capture, as one of our captures, if it has one. */
export function captureOfOrder(
  order: PayPalOrder,
  source: Capture['source'],
): { capture: Capture; status: string } | undefined {
  const entity = order.purchase_units?.[0]?.payments?.captures?.[0];
  return (
    entity && {
      capture: toCapture(order.id, entity, source),
      status: entity.status,
    }
  );
}

const toCapture = (
  orderId: string,
  entity: CaptureEntity,
  source: Capture['source'],
): Capture => ({
  orderId,
  paymentId: entity.id,
  source,
  amount: toMinor(entity.amount.value),
  currency: entity.amount.currency_code,
});

/**
 * Captures an approved order. The request ID makes a retry return the first
 * result instead of charging twice; an order captured already (by another
 * tab, say) is read back instead.
 */
export async function capturePayPalOrder(orderId: string) {
  try {
    return orderSchema.parse(
      await call(`/v2/checkout/orders/${orderId}/capture`, {
        method: 'POST',
        body: {},
        requestId: `capture-${orderId}`,
      }),
    );
  } catch (error) {
    if (
      error instanceof PayPalError &&
      error.issue === 'ORDER_ALREADY_CAPTURED'
    )
      return getPayPalOrder(orderId);
    throw error;
  }
}

/**
 * Asks PayPal whether a webhook call really came from it, for the webhook
 * set up under PAYPAL_WEBHOOK_ID. PayPal checks the signature headers against
 * the event it sent.
 */
export async function verifyPayPalWebhook(
  headers: Record<string, string | string[] | undefined>,
  event: unknown,
) {
  const webhookId = config.paypal?.webhookId;
  if (!webhookId) return false;
  const header = (name: string) => {
    const value = headers[name];
    return typeof value === 'string' ? value : undefined;
  };
  const fields = {
    auth_algo: header('paypal-auth-algo'),
    cert_url: header('paypal-cert-url'),
    transmission_id: header('paypal-transmission-id'),
    transmission_sig: header('paypal-transmission-sig'),
    transmission_time: header('paypal-transmission-time'),
  };
  if (Object.values(fields).some((value) => !value)) return false;
  // PayPal only ever signs with certificates on its own domain.
  try {
    const certHost = new URL(fields.cert_url!).hostname;
    if (!/(^|\.)paypal\.com$/.test(certHost)) return false;
  } catch {
    return false;
  }
  const result = z.object({ verification_status: z.string() }).safeParse(
    await call('/v1/notifications/verify-webhook-signature', {
      method: 'POST',
      body: { ...fields, webhook_id: webhookId, webhook_event: event },
    }),
  );
  return result.success && result.data.verification_status === 'SUCCESS';
}

const webhookSchema = z.object({
  event_type: z.string(),
  resource: z.unknown(),
});

/** What a verified PayPal webhook event asks of us. */
export type PayPalEvent =
  | { kind: 'capture'; capture: Capture }
  | { kind: 'refund'; paymentId: string; amount: number; currency: string }
  | { kind: 'ignore' };

const refundSchema = z.object({
  id: z.string(),
  amount: money.optional(),
  links: z.array(z.object({ rel: z.string(), href: z.string() })).optional(),
});

/**
 * Reads a webhook event. A completed capture is applied like checkout's; a
 * refund or reversal gives the capture ID it took back, with the amount.
 */
export function readPayPalEvent(body: unknown): PayPalEvent {
  const parsed = webhookSchema.safeParse(body);
  if (!parsed.success) return { kind: 'ignore' };
  const { event_type: type, resource } = parsed.data;
  if (type === 'PAYMENT.CAPTURE.COMPLETED') {
    const entity = captureSchema.safeParse(resource);
    const orderId = entity.success
      ? entity.data.supplementary_data?.related_ids?.order_id
      : undefined;
    if (!entity.success || entity.data.status !== 'COMPLETED' || !orderId)
      return { kind: 'ignore' };
    return {
      kind: 'capture',
      capture: toCapture(orderId, entity.data, 'webhook'),
    };
  }
  if (
    type === 'PAYMENT.CAPTURE.REFUNDED' ||
    type === 'PAYMENT.CAPTURE.REVERSED'
  ) {
    const refund = refundSchema.safeParse(resource);
    if (!refund.success || !refund.data.amount) return { kind: 'ignore' };
    // The refund links "up" to the capture it took the money from.
    const up = refund.data.links?.find((link) => link.rel === 'up')?.href;
    const paymentId = up && /\/captures\/([A-Z0-9]+)/.exec(up)?.[1];
    if (!paymentId) return { kind: 'ignore' };
    return {
      kind: 'refund',
      paymentId,
      amount: toMinor(refund.data.amount.value),
      currency: refund.data.amount.currency_code,
    };
  }
  return { kind: 'ignore' };
}

/** The events the webhook needs, for registering it. */
export const PAYPAL_WEBHOOK_EVENTS = [
  'PAYMENT.CAPTURE.COMPLETED',
  'PAYMENT.CAPTURE.REFUNDED',
  'PAYMENT.CAPTURE.REVERSED',
] as const;

/** Registers the webhook for the current mode; returns its ID. */
export async function registerPayPalWebhook(url: string) {
  const body = z.object({ id: z.string() }).parse(
    await call('/v1/notifications/webhooks', {
      method: 'POST',
      body: {
        url,
        event_types: PAYPAL_WEBHOOK_EVENTS.map((name) => ({ name })),
      },
    }),
  );
  return body.id;
}

/** Test hook: forget the cached token. */
export const resetPayPalToken = () => {
  token = undefined;
};
