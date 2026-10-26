// Unpaid orders: their checkout trail, and the daily job that checks them with
// the provider and expires them. Providers are stand-ins; nothing real is
// called. Postgres cases run when TEST_DATABASE_URL points at a disposable
// database (never production).
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';

const { migrate } = await import('../src/db.js');
const { PostgresStore } = await import('../src/pg-store.js');
const { MemoryStore } = await import('../src/store.js');
const {
  applyPayment,
  expireStaleOrders,
  sendCheckoutReminders,
  EXPIRE_AFTER_HOURS,
} = await import('../src/payments.js');
const { webhookFailure } = await import('../src/billing.js');
type Store = import('../src/store.js').Store;
type Capture = import('../src/models.js').Capture;
type OrderCheck = import('../src/payments.js').OrderCheck;

let sequence = 0;
const unique = (prefix: string) =>
  `${prefix}${Date.now().toString(36)}${(sequence++).toString(36)}`;
const HOUR = 3_600_000;

/** Logs collected by level, with the checkout step of each line. */
function recorder() {
  const lines: { level: string; step?: string; message: string }[] = [];
  const at = (level: string) => (context: object, message: string) =>
    void lines.push({
      level,
      step: (context as { checkout?: string }).checkout,
      message,
    });
  return {
    log: { info: at('info'), warn: at('warn'), error: at('error') },
    steps: () => lines.map((line) => line.step),
  };
}

async function unpaidOrder(store: Store, hoursOld: number) {
  const userId = unique('user');
  await store.createAccount({
    id: userId,
    email: `${userId}@test.invalid`,
    name: 'Test',
    color: '#336699',
    createdAt: new Date().toISOString(),
    passwordHash: 'x',
  });
  const orderId = unique('order_');
  await store.createPayment({
    orderId,
    userId,
    amount: 2500,
    currency: 'USD',
    status: 'created',
    plan: 'quarterly',
    months: 3,
    days: 0,
    createdAt: new Date(Date.now() - hoursOld * HOUR).toISOString(),
  });
  return { userId, orderId };
}

function expirySuite(name: string, make: () => Store | undefined) {
  describe(name, () => {
    test('expires only orders older than the window, with a reason', async (t) => {
      const store = make();
      if (!store) return t.skip('no TEST_DATABASE_URL');
      const old = await unpaidOrder(store, EXPIRE_AFTER_HOURS + 1);
      const fresh = await unpaidOrder(store, 1);
      await store.noteOrderEvent(
        old.orderId,
        'client.failed',
        'Card declined, code BAD_REQUEST_ERROR',
      );
      const { log, steps } = recorder();
      const checks: string[] = [];
      const result = await expireStaleOrders({
        store,
        log,
        limit: 500,
        check: async (order): Promise<OrderCheck> => {
          checks.push(order.orderId);
          return { state: 'unpaid', detail: 'Razorpay: not paid' };
        },
        apply: () => assert.fail('nothing should be applied'),
      });
      assert.ok(checks.includes(old.orderId));
      assert.ok(!checks.includes(fresh.orderId));
      assert.ok(result.expired >= 1);
      const expired = await store.getPayment(old.orderId);
      assert.equal(expired?.status, 'expired');
      assert.ok(expired?.expiredAt);
      assert.match(expired!.failureReason!, /Card declined/);
      assert.match(expired!.failureReason!, /Razorpay: not paid/);
      assert.equal((await store.getPayment(fresh.orderId))?.status, 'created');
      assert.ok(steps().includes('expire.expired'));
    });

    test('applies a payment the provider has but we never heard of', async (t) => {
      const store = make();
      if (!store) return t.skip('no TEST_DATABASE_URL');
      const order = await unpaidOrder(store, EXPIRE_AFTER_HOURS + 2);
      const { log, steps } = recorder();
      const deps = {
        store,
        passDays: 30,
        appUrl: 'https://example.test',
        log,
        welcome: undefined,
        background: () => {},
      };
      await expireStaleOrders({
        store,
        log,
        limit: 500,
        check: async (stale): Promise<OrderCheck> =>
          stale.orderId === order.orderId
            ? {
                state: 'paid',
                capture: {
                  orderId: stale.orderId,
                  paymentId: unique('pay_'),
                  source: 'reconcile',
                },
              }
            : { state: 'unpaid' },
        apply: (capture: Capture) => applyPayment(capture, deps),
      });
      assert.equal((await store.getPayment(order.orderId))?.status, 'paid');
      assert.ok((await store.getAccount(order.userId))?.paidUntil);
      assert.ok(steps().includes('expire.recovered'));
      assert.ok(steps().includes('payment.applied'));
    });

    test('a payment arriving after expiry still unlocks Premium', async (t) => {
      const store = make();
      if (!store) return t.skip('no TEST_DATABASE_URL');
      const order = await unpaidOrder(store, EXPIRE_AFTER_HOURS + 3);
      assert.equal(await store.expireOrder(order.orderId, 'test'), true);
      assert.equal(await store.expireOrder(order.orderId, 'again'), false);
      const { log } = recorder();
      const result = await applyPayment(
        {
          orderId: order.orderId,
          paymentId: unique('pay_'),
          source: 'webhook',
        },
        {
          store,
          passDays: 30,
          appUrl: 'https://example.test',
          log,
          welcome: undefined,
          background: () => {},
        },
      );
      assert.equal(result.outcome, 'applied');
      assert.equal((await store.getPayment(order.orderId))?.status, 'paid');
    });

    test('reminds only about checkouts one to two days old', async (t) => {
      const store = make();
      if (!store) return t.skip('no TEST_DATABASE_URL');
      const due = await unpaidOrder(store, 30);
      const stale = await unpaidOrder(store, 100);
      const young = await unpaidOrder(store, 2);
      const emailed: string[] = [];
      const { log } = recorder();
      await sendCheckoutReminders({
        store,
        appUrl: 'https://example.test',
        log,
        limit: 500,
        remind: async (to) => void emailed.push(to),
      });
      assert.ok(emailed.includes(`${due.userId}@test.invalid`));
      assert.ok(!emailed.includes(`${stale.userId}@test.invalid`));
      assert.ok(!emailed.includes(`${young.userId}@test.invalid`));
    });

    test('an unreachable provider still expires the order', async (t) => {
      const store = make();
      if (!store) return t.skip('no TEST_DATABASE_URL');
      const order = await unpaidOrder(store, EXPIRE_AFTER_HOURS + 4);
      const { log, steps } = recorder();
      await expireStaleOrders({
        store,
        log,
        limit: 500,
        check: async () => ({ state: 'unknown', error: new Error('timeout') }),
        apply: () => assert.fail('nothing should be applied'),
      });
      const expired = await store.getPayment(order.orderId);
      assert.equal(expired?.status, 'expired');
      assert.match(expired!.failureReason!, /not checked/);
      assert.ok(steps().includes('expire.check_failed'));
    });
  });
}

expirySuite('memory store', () => new MemoryStore());

const databaseUrl = process.env.TEST_DATABASE_URL;
let pool: pg.Pool | undefined;
let postgres: InstanceType<typeof PostgresStore> | undefined;
before(async () => {
  if (!databaseUrl) return;
  await migrate(databaseUrl);
  pool = new pg.Pool({ connectionString: databaseUrl, max: 4 });
  postgres = new PostgresStore(pool, new MemoryStore());
});
after(async () => {
  await pool?.end();
});
expirySuite('postgres store', () => postgres);

describe('expired orders are purged', () => {
  test('after the purge window, unless money was recorded', async (t) => {
    if (!postgres || !pool) return t.skip('no TEST_DATABASE_URL');
    const order = await unpaidOrder(postgres, EXPIRE_AFTER_HOURS + 5);
    await postgres.expireOrder(order.orderId, 'test');
    await pool.query(
      `UPDATE payments SET expired_at = now() - interval '91 days' WHERE order_id = $1`,
      [order.orderId],
    );
    assert.ok((await postgres.purgeExpiredOrders(90)) >= 1);
    assert.equal(await postgres.getPayment(order.orderId), undefined);
  });
});

describe('Razorpay payment.failed webhook', () => {
  test('reads the order and why it failed', () => {
    const failure = webhookFailure({
      event: 'payment.failed',
      payload: {
        payment: {
          entity: {
            id: 'pay_ABCDEFGHIJ1234',
            order_id: 'order_ABCDEFGHIJ1234',
            amount: 235000,
            currency: 'INR',
            status: 'failed',
            method: 'upi',
            error_code: 'BAD_REQUEST_ERROR',
            error_description: 'Payment was declined by the bank',
            error_source: 'bank',
            error_step: 'payment_authorization',
            error_reason: 'payment_declined',
          },
        },
      },
    });
    assert.equal(failure?.orderId, 'order_ABCDEFGHIJ1234');
    assert.match(failure!.reason, /declined by the bank/);
    assert.match(failure!.reason, /payment_authorization/);
    assert.match(failure!.reason, /method upi/);
    assert.equal(webhookFailure({ event: 'payment.captured' }), undefined);
  });
});
