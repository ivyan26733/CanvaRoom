// PayPal Checkout beside Razorpay, and rupee prices for India. PayPal's API
// is a stand-in (fetch is replaced); no request leaves the machine and no
// email is sent. Postgres cases run when TEST_DATABASE_URL points at a
// disposable database (never production).
import assert from 'node:assert/strict';
import { after, afterEach, before, describe, test } from 'node:test';
import pg from 'pg';

process.env.RAZORPAY_KEY_ID = 'rzp_test_key';
process.env.RAZORPAY_KEY_SECRET = 'test-key-secret';

const { config } = await import('../src/config.js');
const { migrate } = await import('../src/db.js');
const { PostgresStore } = await import('../src/pg-store.js');
const { MemoryStore } = await import('../src/store.js');
const { applyPayment } = await import('../src/payments.js');
const { checkoutFor } = await import('../src/checkout.js');
const { webhookRefund } = await import('../src/billing.js');
const paypal = await import('../src/paypal.js');
const plans = await import('../src/plans.js');
type Store = import('../src/store.js').Store;
type Capture = import('../src/models.js').Capture;
type PremiumWelcome = import('../src/mail.js').PremiumWelcome;

const TESTER = 'tester@example.test';

function usePayPal(mode: 'sandbox' | 'live', webhookId?: string) {
  config.paypal = {
    mode,
    clientId: 'client-id',
    clientSecret: 'client-secret',
    webhookId,
    testers: new Set([TESTER]),
  };
  paypal.resetPayPalToken();
}

type Call = { url: string; init: RequestInit };
const realFetch = globalThis.fetch;

/** Replaces fetch with PayPal stand-ins, answered in order after the token. */
function stubPayPal(...replies: { status?: number; body: unknown }[]) {
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string | URL, init: RequestInit = {}) => {
    const href = String(url);
    calls.push({ url: href, init });
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    if (href.endsWith('/v1/oauth2/token'))
      return json(200, { access_token: 'token', expires_in: 3600 });
    const next = replies.shift();
    if (!next) throw new Error(`Unexpected request to ${href}`);
    return json(next.status ?? 200, next.body);
  }) as typeof fetch;
  return calls;
}

afterEach(() => {
  globalThis.fetch = realFetch;
  config.paypal = undefined;
});

const completedOrder = (
  orderId: string,
  captureId: string,
  value = '20.00',
  status = 'COMPLETED',
) => ({
  id: orderId,
  status: 'COMPLETED',
  purchase_units: [
    {
      custom_id: 'user1',
      payments: {
        captures: [
          {
            id: captureId,
            status,
            amount: { currency_code: 'USD', value },
          },
        ],
      },
    },
  ],
});

describe('prices by region', () => {
  test('India pays in rupees, everyone else in dollars', () => {
    assert.equal(plans.currencyForCountry('IN'), 'INR');
    assert.equal(plans.currencyForCountry('in'), 'INR');
    assert.equal(plans.currencyForCountry('NO'), 'USD');
    assert.equal(plans.currencyForCountry('US'), 'USD');
    assert.equal(plans.currencyForCountry(undefined), 'USD');
  });

  test('the rupee plans and their savings', () => {
    const inr = plans.plansFor('INR');
    assert.deepEqual(
      inr.map((plan) => [plan.id, plan.currency, plan.amount, plan.compareAt]),
      [
        ['quarterly', 'INR', 235000, 235000],
        ['half-year', 'INR', 423000, 470000],
        ['yearly', 'INR', 705000, 940000],
      ],
    );
    assert.deepEqual(
      inr.map((plan) => plan.savePercent),
      [0, 10, 25],
    );
    // Foreign clients see the new dollar prices and discounts.
    assert.deepEqual(
      plans.PLANS.map((plan) => [
        plan.amount,
        plan.compareAt,
        plan.savePercent,
      ]),
      [
        [2500, 2500, 0],
        [4500, 5000, 10],
        [7500, 10000, 25],
      ],
    );
  });

  test('an older rupee order without a stored plan keeps its term', () => {
    const plan = plans.planOfOrder({
      amount: 84900,
      currency: 'INR',
      createdAt: new Date().toISOString(),
    });
    assert.equal(plan?.id, 'half-year');
    assert.equal(plan?.currency, 'INR');
  });
});

describe('who pays how', () => {
  test('India always gets Razorpay', () => {
    usePayPal('live');
    assert.equal(checkoutFor('INR', 'someone@example.test'), 'razorpay');
  });

  test('abroad gets PayPal once it is live', () => {
    usePayPal('live');
    assert.equal(checkoutFor('USD', 'someone@example.test'), 'paypal');
  });

  test('in sandbox mode only testers get PayPal; others keep Razorpay', () => {
    usePayPal('sandbox');
    assert.equal(checkoutFor('USD', TESTER), 'paypal');
    assert.equal(checkoutFor('USD', 'TESTER@example.test '), 'paypal');
    assert.equal(checkoutFor('USD', 'someone@example.test'), 'razorpay');
    assert.equal(checkoutFor('USD', undefined), 'razorpay');
    assert.equal(paypal.paypalAllowedFor('someone@example.test'), false);
  });

  test('without PayPal keys nobody gets PayPal', () => {
    assert.equal(checkoutFor('USD', TESTER), 'razorpay');
  });
});

describe('PayPal API', () => {
  test('creates an order for the plan’s amount, with no shipping', async () => {
    usePayPal('sandbox');
    const calls = stubPayPal({
      body: { id: 'ORDER1234567890AB', status: 'CREATED' },
    });
    const plan = plans.planById('yearly')!;
    const order = await paypal.createPayPalOrder(plan, 'user1');
    assert.deepEqual(order, {
      orderId: 'ORDER1234567890AB',
      amount: 7500,
      currency: 'USD',
    });
    const create = calls.find((call) =>
      call.url.endsWith('/v2/checkout/orders'),
    )!;
    assert.match(create.url, /^https:\/\/api-m\.sandbox\.paypal\.com\//);
    const body = JSON.parse(String(create.init.body));
    assert.equal(body.intent, 'CAPTURE');
    assert.deepEqual(body.purchase_units[0].amount, {
      currency_code: 'USD',
      value: '75.00',
    });
    assert.equal(body.purchase_units[0].custom_id, 'user1');
    assert.equal(body.application_context.shipping_preference, 'NO_SHIPPING');
  });

  test('live mode calls the live API', async () => {
    usePayPal('live');
    const calls = stubPayPal({
      body: { id: 'ORDER1234567890AB', status: 'CREATED' },
    });
    await paypal.createPayPalOrder(plans.planById('quarterly')!, 'user1');
    assert.ok(
      calls.every((call) => call.url.startsWith('https://api-m.paypal.com/')),
    );
  });

  test('captures once per order, and reads back an order captured already', async () => {
    usePayPal('sandbox');
    const calls = stubPayPal(
      {
        status: 422,
        body: {
          name: 'UNPROCESSABLE_ENTITY',
          details: [{ issue: 'ORDER_ALREADY_CAPTURED' }],
        },
      },
      { body: completedOrder('ORDER1234567890AB', 'CAPTURE1234567890') },
    );
    const order = await paypal.capturePayPalOrder('ORDER1234567890AB');
    const capture = calls.find((call) => call.url.endsWith('/capture'))!;
    assert.equal(
      (capture.init.headers as Record<string, string>)['PayPal-Request-Id'],
      'capture-ORDER1234567890AB',
    );
    const found = paypal.captureOfOrder(order, 'checkout');
    assert.deepEqual(found, {
      status: 'COMPLETED',
      capture: {
        orderId: 'ORDER1234567890AB',
        paymentId: 'CAPTURE1234567890',
        source: 'checkout',
        amount: 2000,
        currency: 'USD',
      },
    });
  });

  test('a declined card is reported as such', async () => {
    usePayPal('sandbox');
    stubPayPal({
      status: 422,
      body: { details: [{ issue: 'INSTRUMENT_DECLINED' }] },
    });
    await assert.rejects(
      paypal.capturePayPalOrder('ORDER1234567890AB'),
      (error: unknown) =>
        error instanceof paypal.PayPalError &&
        error.issue === 'INSTRUMENT_DECLINED',
    );
  });

  test('amounts are read exactly', () => {
    assert.equal(paypal.toMinor('20.00'), 2000);
    assert.equal(paypal.toMinor('65'), 6500);
    assert.equal(paypal.toMinor('5.5'), 550);
    assert.ok(Number.isNaN(paypal.toMinor('20.001')));
    assert.ok(Number.isNaN(paypal.toMinor('-20.00')));
    assert.ok(Number.isNaN(paypal.toMinor('1e3')));
  });
});

describe('PayPal webhook', () => {
  const headers = {
    'paypal-auth-algo': 'SHA256withRSA',
    'paypal-cert-url':
      'https://api.sandbox.paypal.com/v1/notifications/certs/CERT',
    'paypal-transmission-id': 'id',
    'paypal-transmission-sig': 'sig',
    'paypal-transmission-time': '2026-10-22T10:00:00Z',
  };

  test('is refused without a webhook ID', async () => {
    usePayPal('sandbox');
    assert.equal(await paypal.verifyPayPalWebhook(headers, {}), false);
  });

  test('is refused without PayPal’s headers, or with a foreign certificate', async () => {
    usePayPal('sandbox', 'WH-1');
    stubPayPal();
    assert.equal(await paypal.verifyPayPalWebhook({}, {}), false);
    assert.equal(
      await paypal.verifyPayPalWebhook(
        { ...headers, 'paypal-cert-url': 'https://evil.example/cert' },
        {},
      ),
      false,
    );
    assert.equal(
      await paypal.verifyPayPalWebhook(
        { ...headers, 'paypal-cert-url': 'https://paypal.com.evil.example/c' },
        {},
      ),
      false,
    );
  });

  test('asks PayPal to confirm the event, and trusts only SUCCESS', async () => {
    usePayPal('sandbox', 'WH-1');
    const calls = stubPayPal(
      { body: { verification_status: 'SUCCESS' } },
      { body: { verification_status: 'FAILURE' } },
    );
    const event = { id: 'WH-EVENT', event_type: 'PAYMENT.CAPTURE.COMPLETED' };
    assert.equal(await paypal.verifyPayPalWebhook(headers, event), true);
    assert.equal(await paypal.verifyPayPalWebhook(headers, event), false);
    const verify = JSON.parse(String(calls[1]!.init.body));
    assert.equal(verify.webhook_id, 'WH-1');
    assert.deepEqual(verify.webhook_event, event);
    assert.equal(verify.transmission_sig, 'sig');
  });

  test('reads captures and refunds', () => {
    assert.deepEqual(
      paypal.readPayPalEvent({
        event_type: 'PAYMENT.CAPTURE.COMPLETED',
        resource: {
          id: 'CAPTURE1234567890',
          status: 'COMPLETED',
          amount: { currency_code: 'USD', value: '45.00' },
          supplementary_data: {
            related_ids: { order_id: 'ORDER1234567890AB' },
          },
        },
      }),
      {
        kind: 'capture',
        capture: {
          orderId: 'ORDER1234567890AB',
          paymentId: 'CAPTURE1234567890',
          source: 'webhook',
          amount: 4500,
          currency: 'USD',
        },
      },
    );
    assert.deepEqual(
      paypal.readPayPalEvent({
        event_type: 'PAYMENT.CAPTURE.REFUNDED',
        resource: {
          id: 'REFUND1234567890',
          amount: { currency_code: 'USD', value: '45.00' },
          links: [
            {
              rel: 'up',
              href: 'https://api.paypal.com/v2/payments/captures/CAPTURE1234567890',
            },
          ],
        },
      }),
      {
        kind: 'refund',
        paymentId: 'CAPTURE1234567890',
        amount: 4500,
        currency: 'USD',
      },
    );
    // A pending capture, other events and junk are ignored.
    assert.equal(
      paypal.readPayPalEvent({
        event_type: 'PAYMENT.CAPTURE.COMPLETED',
        resource: {
          id: 'CAPTURE1234567890',
          status: 'PENDING',
          amount: { currency_code: 'USD', value: '45.00' },
          supplementary_data: {
            related_ids: { order_id: 'ORDER1234567890AB' },
          },
        },
      }).kind,
      'ignore',
    );
    assert.equal(
      paypal.readPayPalEvent({
        event_type: 'CHECKOUT.ORDER.APPROVED',
        resource: {},
      }).kind,
      'ignore',
    );
    assert.equal(paypal.readPayPalEvent('nonsense').kind, 'ignore');
  });

  test('Razorpay refunds are read too', () => {
    assert.deepEqual(
      webhookRefund({
        event: 'refund.processed',
        payload: {
          refund: {
            entity: {
              payment_id: 'pay_ABC123456',
              amount: 235000,
              currency: 'INR',
              status: 'processed',
            },
          },
        },
      }),
      { paymentId: 'pay_ABC123456', amount: 235000, currency: 'INR' },
    );
    assert.equal(webhookRefund({ event: 'payment.captured' }), undefined);
  });
});

let sequence = 0;
const unique = (prefix: string) =>
  `${prefix}${Date.now().toString(36).toUpperCase()}${(sequence++).toString(36).toUpperCase()}`;

/** A PayPal order (IDs in PayPal's shape) for a plan, in dollars or rupees. */
async function paypalOrder(
  store: Store,
  planId: import('../src/plans.js').PlanId = 'quarterly',
  currency: import('../src/plans.js').Currency = 'USD',
) {
  const userId = unique('user');
  await store.createAccount({
    id: userId,
    email: `${userId}@test.invalid`,
    name: 'Test',
    color: '#336699',
    createdAt: new Date().toISOString(),
    passwordHash: 'x',
  });
  const plan = plans.planById(planId, currency)!;
  const orderId = unique('PP').padEnd(17, 'X').slice(0, 20);
  await store.createPayment({
    orderId,
    userId,
    provider: currency === 'USD' ? 'paypal' : 'razorpay',
    amount: plan.amount,
    currency: plan.currency,
    plan: plan.id,
    ...plans.termOfPlan(plan),
    status: 'created',
    createdAt: new Date().toISOString(),
  });
  return { userId, orderId, plan, paymentId: unique('CAP').padEnd(17, 'X') };
}

const quiet = { info() {}, warn() {}, error() {} };

function harness(store: Store) {
  const sent: { to: string; welcome: PremiumWelcome }[] = [];
  const tasks: Promise<void>[] = [];
  const deps = {
    store,
    passDays: 30,
    appUrl: 'https://example.test',
    log: quiet,
    welcome: async (to: string, welcome: PremiumWelcome) =>
      void sent.push({ to, welcome }),
    background: (task: Promise<void>) => void tasks.push(task),
  };
  return { deps, sent, settle: () => Promise.all(tasks) };
}

const DAY = 86_400_000;

function storeSuite(name: string, make: () => Store | undefined) {
  describe(name, () => {
    test('PayPal capture and webhook together apply once, with one email', async (t) => {
      const store = make();
      if (!store) return t.skip('no TEST_DATABASE_URL');
      const { userId, orderId, paymentId } = await paypalOrder(
        store,
        'half-year',
      );
      const { deps, sent, settle } = harness(store);
      const capture = (source: Capture['source']): Capture => ({
        orderId,
        paymentId,
        source,
        amount: 4500,
        currency: 'USD',
      });
      const results = await Promise.all(
        (['checkout', 'webhook', 'webhook', 'checkout'] as const).map(
          (source) => applyPayment(capture(source), deps),
        ),
      );
      await settle();
      assert.equal(results.filter((r) => r.outcome === 'applied').length, 1);
      assert.equal(sent.length, 1);
      assert.equal(sent[0]!.welcome.term, '6 months + 15 days free');
      const until = Date.parse((await store.getAccount(userId))!.paidUntil!);
      assert.ok(
        until > Date.now() + 190 * DAY && until < Date.now() + 200 * DAY,
      );
      assert.equal((await store.getPayment(orderId))?.provider, 'paypal');
    });

    test('a PayPal capture for the wrong amount changes nothing', async (t) => {
      const store = make();
      if (!store) return t.skip('no TEST_DATABASE_URL');
      const { userId, orderId, paymentId } = await paypalOrder(store, 'yearly');
      const { deps, sent, settle } = harness(store);
      for (const [amount, currency] of [
        [100, 'USD'],
        [6500, 'EUR'],
        [Number.NaN, 'USD'],
      ] as const) {
        const result = await applyPayment(
          { orderId, paymentId, source: 'webhook', amount, currency },
          deps,
        );
        assert.equal(result.outcome, 'mismatch');
      }
      await settle();
      assert.equal(sent.length, 0);
      assert.equal((await store.getAccount(userId))?.paidUntil, undefined);
    });

    test('rupee orders buy the same time', async (t) => {
      const store = make();
      if (!store) return t.skip('no TEST_DATABASE_URL');
      const { userId, orderId } = await paypalOrder(store, 'yearly', 'INR');
      const { deps, sent, settle } = harness(store);
      const result = await applyPayment(
        {
          orderId,
          paymentId: unique('pay_'),
          source: 'webhook',
          amount: 705000,
          currency: 'INR',
        },
        deps,
      );
      await settle();
      assert.equal(result.outcome, 'applied');
      assert.equal(sent[0]!.welcome.amount, 705000);
      assert.equal(sent[0]!.welcome.currency, 'INR');
      const until = Date.parse((await store.getAccount(userId))!.paidUntil!);
      assert.ok(
        until > Date.now() + 390 * DAY && until < Date.now() + 400 * DAY,
      );
    });

    test('open orders are reused only with the same provider', async (t) => {
      const store = make();
      if (!store) return t.skip('no TEST_DATABASE_URL');
      const { userId, orderId, plan } = await paypalOrder(store, 'quarterly');
      assert.equal(
        (await store.openOrder(userId, plan, 20, 'paypal'))?.orderId,
        orderId,
      );
      assert.equal(
        await store.openOrder(userId, plan, 20, 'razorpay'),
        undefined,
      );
    });

    test('a full refund takes the time back once; a partial one leaves it', async (t) => {
      const store = make();
      if (!store) return t.skip('no TEST_DATABASE_URL');
      const { deps } = harness(store);
      const first = await paypalOrder(store, 'quarterly');
      await applyPayment(
        {
          orderId: first.orderId,
          paymentId: first.paymentId,
          source: 'checkout',
        },
        deps,
      );
      const paid = Date.parse(
        (await store.getAccount(first.userId))!.paidUntil!,
      );
      assert.ok(paid > Date.now() + 85 * DAY);

      const partial = await store.refundPayment(
        { paymentId: first.paymentId, amount: 500, currency: 'USD' },
        30,
      );
      assert.equal(partial.outcome, 'partial');
      assert.equal(
        Date.parse((await store.getAccount(first.userId))!.paidUntil!),
        paid,
      );

      const refunds = await Promise.all(
        [1, 2].map(() =>
          store.refundPayment(
            { paymentId: first.paymentId, amount: 2500, currency: 'USD' },
            30,
          ),
        ),
      );
      assert.deepEqual(refunds.map((r) => r.outcome).sort(), [
        'refunded',
        'repeat',
      ]);
      // Never earlier than now: Premium simply ends.
      const after = Date.parse(
        (await store.getAccount(first.userId))!.paidUntil!,
      );
      assert.ok(after <= Date.now() + 1000 && after > Date.now() - 60_000);
      assert.equal(
        (
          await store.refundPayment(
            { paymentId: 'UNKNOWN1234567890', amount: 2500, currency: 'USD' },
            30,
          )
        ).outcome,
        'unknown',
      );
    });

    test('refunding one of two passes keeps the other', async (t) => {
      const store = make();
      if (!store) return t.skip('no TEST_DATABASE_URL');
      const { deps } = harness(store);
      const first = await paypalOrder(store, 'quarterly');
      const userId = first.userId;
      await applyPayment(
        {
          orderId: first.orderId,
          paymentId: first.paymentId,
          source: 'checkout',
        },
        deps,
      );
      // A second order for the same account.
      const plan = plans.planById('yearly')!;
      const secondId = unique('PP').padEnd(17, 'Y');
      await store.createPayment({
        orderId: secondId,
        userId,
        provider: 'paypal',
        amount: plan.amount,
        currency: 'USD',
        plan: plan.id,
        ...plans.termOfPlan(plan),
        status: 'created',
        createdAt: new Date().toISOString(),
      });
      const secondPayment = unique('CAP').padEnd(17, 'Y');
      await applyPayment(
        { orderId: secondId, paymentId: secondPayment, source: 'webhook' },
        deps,
      );
      const result = await store.refundPayment(
        { paymentId: first.paymentId, amount: 2500, currency: 'USD' },
        30,
      );
      assert.equal(result.outcome, 'refunded');
      // 13 months remain from the yearly plan.
      const until = Date.parse((await store.getAccount(userId))!.paidUntil!);
      assert.ok(
        until > Date.now() + 390 * DAY && until < Date.now() + 400 * DAY,
      );
    });
  });
}

storeSuite('memory store', () => new MemoryStore());

const databaseUrl = process.env.TEST_DATABASE_URL;
let pool: pg.Pool | undefined;
let postgres: Store | undefined;
before(async () => {
  if (!databaseUrl) return;
  await migrate(databaseUrl);
  pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
  postgres = new PostgresStore(pool, new MemoryStore());
});
after(async () => {
  await pool?.end();
});
storeSuite('postgres store', () => postgres);

test('postgres takes PayPal orders before it is migrated for them', async (t) => {
  if (!postgres || !pool || !databaseUrl) return t.skip('no TEST_DATABASE_URL');
  await pool.query(
    'ALTER TABLE payments DROP COLUMN provider, DROP COLUMN refunded_at',
  );
  try {
    const { userId, orderId, paymentId } = await paypalOrder(
      postgres,
      'half-year',
    );
    // The provider is told from the order ID, and the plan is kept.
    const stored = await postgres.getPayment(orderId);
    assert.equal(stored?.plan, 'half-year');
    assert.equal(stored?.provider, undefined);
    const { deps } = harness(postgres);
    const result = await applyPayment(
      { orderId, paymentId, source: 'checkout', amount: 4500, currency: 'USD' },
      deps,
    );
    assert.equal(result.outcome, 'applied');
    assert.ok((await postgres.getAccount(userId))?.paidUntil);
    // Refunds wait for the migration rather than failing.
    assert.equal(
      (
        await postgres.refundPayment(
          { paymentId, amount: 4500, currency: 'USD' },
          30,
        )
      ).outcome,
      'unmigrated',
    );
    // Migrating marks the order as PayPal's, not the column's default.
    await migrate(databaseUrl);
    assert.equal((await postgres.getPayment(orderId))?.provider, 'paypal');
  } finally {
    await migrate(databaseUrl);
  }
});
