// Payments under concurrency: the browser's verify call, Razorpay's webhook
// and retries of either may arrive at once. Postgres cases run when
// TEST_DATABASE_URL points at a disposable database (never production).
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';

process.env.RAZORPAY_KEY_ID = 'rzp_test_key';
process.env.RAZORPAY_KEY_SECRET = 'test-key-secret';
process.env.RAZORPAY_WEBHOOK_SECRET = 'test-webhook-secret';

const { migrate } = await import('../src/db.js');
const { PostgresStore } = await import('../src/pg-store.js');
const { MemoryStore } = await import('../src/store.js');
const billing = await import('../src/billing.js');
const plans = await import('../src/plans.js');
type Store = import('../src/store.js').Store;
type Capture = import('../src/models.js').Capture;

const DAY = 86_400_000;
let sequence = 0;
const unique = (prefix: string) =>
  `${prefix}${Date.now().toString(36)}${(sequence++).toString(36)}`;

async function account(store: Store) {
  const id = unique('user');
  await store.createAccount({
    id,
    email: `${id}@test.invalid`,
    name: 'Test',
    color: '#336699',
    createdAt: new Date().toISOString(),
    passwordHash: 'x',
  });
  return id;
}

/**
 * An unpaid order: by default a one-month order from before the plans (30
 * days), otherwise one for the given plan.
 */
async function order(
  store: Store,
  userId: string,
  kind: 'legacy' | import('../src/plans.js').PlanId = 'legacy',
) {
  const orderId = unique('order_');
  const plan = kind === 'legacy' ? undefined : plans.planById(kind)!;
  await store.createPayment({
    orderId,
    userId,
    amount: plan?.amount ?? 2000,
    currency: 'USD',
    status: 'created',
    ...(plan ? { plan: plan.id, ...plans.termOfPlan(plan) } : {}),
    createdAt: plan
      ? new Date().toISOString()
      : new Date(plans.PLANS_SINCE - DAY).toISOString(),
  });
  return orderId;
}

/** Whether two instants are within two hours (a DST shift in a local DB). */
const near = (a: string | undefined, b: string) =>
  Boolean(a) && Math.abs(Date.parse(a!) - Date.parse(b)) < 2 * 3_600_000;

const daysLeft = async (store: Store, userId: string) => {
  const until = (await store.getAccount(userId))?.paidUntil;
  return until ? (Date.parse(until) - Date.now()) / DAY : 0;
};

function paymentSuite(name: string, make: () => Store | undefined) {
  describe(name, () => {
    const store = () => {
      const value = make();
      assert.ok(value);
      return value;
    };

    test('checkout and webhook together apply the payment once', async (t) => {
      if (!make()) return t.skip('no TEST_DATABASE_URL');
      const userId = await account(store());
      const orderId = await order(store(), userId);
      const paymentId = unique('pay_');
      const sources: Capture['source'][] = [
        'checkout',
        'webhook',
        'webhook',
        'checkout',
        'reconcile',
        'webhook',
      ];
      const results = await Promise.all(
        sources.map((source) =>
          store().recordPayment(
            source === 'checkout'
              ? { orderId, paymentId, source }
              : { orderId, paymentId, source, amount: 2000, currency: 'USD' },
            30,
          ),
        ),
      );
      const outcomes = results.map((result) => result.outcome).sort();
      assert.deepEqual(outcomes, [
        'applied',
        'repeat',
        'repeat',
        'repeat',
        'repeat',
        'repeat',
      ]);
      const left = await daysLeft(store(), userId);
      assert.ok(left > 29.9 && left <= 30, `pass has ${left} days`);
    });

    test('two orders paid at once both extend the pass', async (t) => {
      if (!make()) return t.skip('no TEST_DATABASE_URL');
      const userId = await account(store());
      const [first, second] = await Promise.all([
        order(store(), userId),
        order(store(), userId),
      ]);
      const results = await Promise.all([
        store().recordPayment(
          { orderId: first, paymentId: unique('pay_'), source: 'checkout' },
          30,
        ),
        store().recordPayment(
          { orderId: second, paymentId: unique('pay_'), source: 'webhook' },
          30,
        ),
      ]);
      assert.deepEqual(
        results.map((result) => result.outcome),
        ['applied', 'applied'],
      );
      const left = await daysLeft(store(), userId);
      assert.ok(left > 59.9 && left <= 60, `pass has ${left} days`);
    });

    test('a second payment on a paid order is not applied', async (t) => {
      if (!make()) return t.skip('no TEST_DATABASE_URL');
      const userId = await account(store());
      const orderId = await order(store(), userId);
      await store().recordPayment(
        { orderId, paymentId: unique('pay_'), source: 'checkout' },
        30,
      );
      const extra = await store().recordPayment(
        { orderId, paymentId: unique('pay_'), source: 'webhook' },
        30,
      );
      assert.equal(extra.outcome, 'extra');
      const left = await daysLeft(store(), userId);
      assert.ok(left <= 30, `pass has ${left} days`);
    });

    test('a different amount or an unknown order changes nothing', async (t) => {
      if (!make()) return t.skip('no TEST_DATABASE_URL');
      const userId = await account(store());
      const orderId = await order(store(), userId);
      const mismatch = await store().recordPayment(
        {
          orderId,
          paymentId: unique('pay_'),
          source: 'webhook',
          amount: 100,
          currency: 'USD',
        },
        30,
      );
      assert.equal(mismatch.outcome, 'mismatch');
      const unknown = await store().recordPayment(
        {
          orderId: unique('order_'),
          paymentId: unique('pay_'),
          source: 'webhook',
        },
        30,
      );
      assert.equal(unknown.outcome, 'unknown');
      assert.equal(await daysLeft(store(), userId), 0);
      assert.equal((await store().getPayment(orderId))?.status, 'created');
    });

    test('a recent unpaid order is reused for its plan only', async (t) => {
      if (!make()) return t.skip('no TEST_DATABASE_URL');
      const [quarterly, halfYear] = [
        plans.planById('quarterly')!,
        plans.planById('half-year')!,
      ];
      const userId = await account(store());
      const orderId = await order(store(), userId, 'quarterly');
      assert.equal(
        (await store().openOrder(userId, quarterly, 20, 'razorpay'))?.orderId,
        orderId,
      );
      assert.equal(
        await store().openOrder(userId, halfYear, 20, 'razorpay'),
        undefined,
      );
      await store().recordPayment(
        { orderId, paymentId: unique('pay_'), source: 'checkout' },
        30,
      );
      assert.equal(
        await store().openOrder(userId, quarterly, 20, 'razorpay'),
        undefined,
      );
    });

    test('a one-month order from before the plans is never reused', async (t) => {
      if (!make()) return t.skip('no TEST_DATABASE_URL');
      const userId = await account(store());
      await order(store(), userId);
      assert.equal(
        await store().openOrder(
          userId,
          plans.planById('quarterly')!,
          60 * 24 * 365,
          'razorpay',
        ),
        undefined,
      );
    });

    for (const plan of plans.PLANS)
      test(`the ${plan.id} plan adds its months and bonus`, async (t) => {
        if (!make()) return t.skip('no TEST_DATABASE_URL');
        const userId = await account(store());
        const orderId = await order(store(), userId, plan.id);
        const result = await store().recordPayment(
          {
            orderId,
            paymentId: unique('pay_'),
            source: 'webhook',
            amount: plan.amount,
            currency: 'USD',
          },
          30,
        );
        assert.equal(result.outcome, 'applied');
        const expected = plans.extendBy(undefined, plans.termOfPlan(plan));
        const until = (await store().getAccount(userId))?.paidUntil;
        assert.ok(near(until, expected), `${until} vs ${expected}`);
      });

    test('plans stack from the end of the current pass', async (t) => {
      if (!make()) return t.skip('no TEST_DATABASE_URL');
      const userId = await account(store());
      const first = await order(store(), userId, 'yearly');
      const second = await order(store(), userId, 'half-year');
      // Paid at the same moment: each waits for the other, neither is lost.
      await Promise.all(
        [first, second].map((orderId) =>
          store().recordPayment(
            { orderId, paymentId: unique('pay_'), source: 'webhook' },
            30,
          ),
        ),
      );
      // 13 months, then 6 months and 15 days, in either order.
      const expected = plans.extendBy(undefined, { months: 19, days: 15 });
      const until = (await store().getAccount(userId))?.paidUntil;
      assert.ok(
        Math.abs(Date.parse(until!) - Date.parse(expected)) < 4 * DAY,
        `${until} vs ${expected}`,
      );
    });

    test('an order with no plan recorded is told apart by its amount', async (t) => {
      if (!make()) return t.skip('no TEST_DATABASE_URL');
      const userId = await account(store());
      const orderId = unique('order_');
      // As written by a server whose database wasn't migrated yet.
      await store().createPayment({
        orderId,
        userId,
        amount: 3500,
        currency: 'USD',
        status: 'created',
        createdAt: new Date().toISOString(),
      });
      await store().recordPayment(
        { orderId, paymentId: unique('pay_'), source: 'checkout' },
        30,
      );
      const expected = plans.extendBy(undefined, { months: 6, days: 15 });
      const until = (await store().getAccount(userId))?.paidUntil;
      assert.ok(near(until, expected), `${until} vs ${expected}`);
    });
  });
}

const memory = new MemoryStore();
paymentSuite('memory store', () => memory);

const databaseUrl = process.env.TEST_DATABASE_URL;
let postgres: InstanceType<typeof PostgresStore> | undefined;
let pool: pg.Pool | undefined;
before(async () => {
  if (!databaseUrl) return;
  await migrate(databaseUrl);
  pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
  postgres = new PostgresStore(pool, new MemoryStore());
});
after(async () => {
  await pool?.end();
});
paymentSuite('postgres store', () => postgres);

test('postgres keeps one ledger row per payment', async (t) => {
  if (!postgres || !pool) return t.skip('no TEST_DATABASE_URL');
  const userId = await account(postgres);
  const orderId = await order(postgres, userId);
  const paymentId = unique('pay_');
  await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      postgres!.recordPayment(
        { orderId, paymentId, source: index % 2 ? 'webhook' : 'checkout' },
        30,
      ),
    ),
  );
  const extra = unique('pay_');
  await postgres.recordPayment(
    { orderId, paymentId: extra, source: 'webhook' },
    30,
  );
  const { rows } = await pool.query<{ payment_id: string; applied: boolean }>(
    `SELECT payment_id, applied FROM payment_captures WHERE order_id = $1 ORDER BY applied DESC`,
    [orderId],
  );
  assert.deepEqual(rows, [
    { payment_id: paymentId, applied: true },
    { payment_id: extra, applied: false },
  ]);
});

describe('razorpay signatures', () => {
  const sign = (secret: string, data: string | Buffer) =>
    createHmac('sha256', secret).update(data).digest('hex');

  test('payment signatures', () => {
    const good = sign('test-key-secret', 'order_abc123|pay_def456');
    assert.ok(
      billing.validPaymentSignature('order_abc123', 'pay_def456', good),
    );
    assert.ok(
      !billing.validPaymentSignature('order_abc123', 'pay_other1', good),
    );
    assert.ok(
      !billing.validPaymentSignature('order_abc123', 'pay_def456', 'zz'),
    );
  });

  test('webhook signatures cover the raw body', () => {
    const body = Buffer.from('{"event":"payment.captured"}');
    const good = sign('test-webhook-secret', body);
    assert.ok(billing.validWebhookSignature(body, good));
    assert.ok(
      !billing.validWebhookSignature(
        Buffer.from('{"event": "payment.captured"}'),
        good,
      ),
    );
    assert.ok(!billing.validWebhookSignature(body, sign('wrong', body)));
  });

  test('only captured payments in our events are taken', () => {
    const event = (name: string, status: string) => ({
      event: name,
      payload: {
        payment: {
          entity: {
            id: 'pay_abc123',
            order_id: 'order_abc123',
            amount: 2000,
            currency: 'USD',
            status,
          },
        },
      },
    });
    assert.deepEqual(
      billing.webhookCapture(event('payment.captured', 'captured')),
      {
        orderId: 'order_abc123',
        paymentId: 'pay_abc123',
        source: 'webhook',
        amount: 2000,
        currency: 'USD',
      },
    );
    assert.equal(
      billing.webhookCapture(event('order.paid', 'captured'))?.paymentId,
      'pay_abc123',
    );
    assert.equal(
      billing.webhookCapture(event('payment.authorized', 'authorized')),
      undefined,
    );
    assert.equal(
      billing.webhookCapture(event('payment.captured', 'failed')),
      undefined,
    );
    assert.equal(
      billing.webhookCapture({ event: 'refund.created' }),
      undefined,
    );
    assert.equal(billing.webhookCapture('nonsense'), undefined);
  });
});

test('postgres applies payments before the ledger table exists', async (t) => {
  if (!postgres || !pool || !databaseUrl) return t.skip('no TEST_DATABASE_URL');
  await pool.query('DROP TABLE payment_captures');
  try {
    const userId = await account(postgres);
    const orderId = await order(postgres, userId);
    const result = await postgres.recordPayment(
      { orderId, paymentId: unique('pay_'), source: 'checkout' },
      30,
    );
    assert.equal(result.outcome, 'applied');
    assert.equal((await postgres.getPayment(orderId))?.status, 'paid');
  } finally {
    // The schema is safe to apply again, and puts the table back.
    await migrate(databaseUrl);
  }
});

test('postgres sells plans before the plan columns exist', async (t) => {
  if (!postgres || !pool || !databaseUrl) return t.skip('no TEST_DATABASE_URL');
  await pool.query(
    'ALTER TABLE payments DROP COLUMN plan, DROP COLUMN months, DROP COLUMN days',
  );
  try {
    const userId = await account(postgres);
    // Written with its plan; the database can't keep it, the amount can.
    const orderId = await order(postgres, userId, 'half-year');
    const halfYear = plans.planById('half-year')!;
    assert.equal(
      (await postgres.openOrder(userId, halfYear, 20, 'razorpay'))?.orderId,
      orderId,
    );
    assert.equal(
      await postgres.openOrder(
        userId,
        plans.planById('yearly')!,
        20,
        'razorpay',
      ),
      undefined,
    );
    const result = await postgres.recordPayment(
      { orderId, paymentId: unique('pay_'), source: 'webhook' },
      30,
    );
    assert.equal(result.outcome, 'applied');
    const expected = plans.extendBy(undefined, { months: 6, days: 15 });
    assert.ok(near((await postgres.getAccount(userId))?.paidUntil, expected));
  } finally {
    await migrate(databaseUrl);
  }
});
