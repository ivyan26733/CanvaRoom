// The thank-you email after a Premium payment: sent once per payment however
// many paths report it, never blocking or undoing the payment. The mailer is
// a stand-in; no real email is sent. Postgres cases run when
// TEST_DATABASE_URL points at a disposable database (never production).
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';

const { migrate } = await import('../src/db.js');
const { PostgresStore } = await import('../src/pg-store.js');
const { MemoryStore } = await import('../src/store.js');
const { applyPayment } = await import('../src/payments.js');
const { premiumWelcomeEmail } = await import('../src/mail.js');
type Store = import('../src/store.js').Store;
type Capture = import('../src/models.js').Capture;
type PremiumWelcome = import('../src/mail.js').PremiumWelcome;

let sequence = 0;
const unique = (prefix: string) =>
  `${prefix}${Date.now().toString(36)}${(sequence++).toString(36)}`;

async function paidOrder(store: Store, name = 'Test') {
  const userId = unique('user');
  await store.createAccount({
    id: userId,
    email: `${userId}@test.invalid`,
    name,
    color: '#336699',
    createdAt: new Date().toISOString(),
    passwordHash: 'x',
  });
  const orderId = unique('order_');
  await store.createPayment({
    orderId,
    userId,
    amount: 2000,
    currency: 'USD',
    status: 'created',
    createdAt: new Date().toISOString(),
  });
  return { userId, orderId, paymentId: unique('pay_') };
}

const quiet = { info() {}, warn() {}, error() {} };

/** Deps whose mailer records each email; `fail` makes it throw instead. */
function harness(store: Store, fail = false) {
  const sent: { to: string; welcome: PremiumWelcome }[] = [];
  const tasks: Promise<void>[] = [];
  const errors: string[] = [];
  const deps = {
    store,
    passDays: 30,
    appUrl: 'https://example.test',
    log: {
      ...quiet,
      error: (_: object, message: string) => void errors.push(message),
    },
    welcome: async (to: string, welcome: PremiumWelcome) => {
      if (fail) throw new Error('SMTP down');
      sent.push({ to, welcome });
    },
    background: (task: Promise<void>) => void tasks.push(task),
  };
  return { deps, sent, errors, settle: () => Promise.all(tasks) };
}

function emailSuite(name: string, make: () => Store | undefined) {
  describe(name, () => {
    test('checkout, webhook and retries together send one email', async (t) => {
      const store = make();
      if (!store) return t.skip('no TEST_DATABASE_URL');
      const { userId, orderId, paymentId } = await paidOrder(store);
      const { deps, sent, settle } = harness(store);
      const sources: Capture['source'][] = [
        'checkout',
        'webhook',
        'webhook',
        'checkout',
        'reconcile',
      ];
      const results = await Promise.all(
        sources.map((source) =>
          applyPayment({ orderId, paymentId, source }, deps),
        ),
      );
      await settle();
      assert.equal(results.filter((r) => r.outcome === 'applied').length, 1);
      assert.equal(sent.length, 1);
      assert.equal(sent[0]!.to, `${userId}@test.invalid`);
      assert.equal(sent[0]!.welcome.amount, 2000);
      assert.equal(sent[0]!.welcome.currency, 'USD');
      assert.equal(sent[0]!.welcome.paymentId, paymentId);
      // A later retry is a repeat and sends nothing more.
      await applyPayment({ orderId, paymentId, source: 'webhook' }, deps);
      await settle();
      assert.equal(sent.length, 1);
    });

    test('a second payment on a paid order sends nothing', async (t) => {
      const store = make();
      if (!store) return t.skip('no TEST_DATABASE_URL');
      const { orderId, paymentId } = await paidOrder(store);
      const { deps, sent, settle } = harness(store);
      await applyPayment({ orderId, paymentId, source: 'checkout' }, deps);
      const extra = await applyPayment(
        { orderId, paymentId: unique('pay_'), source: 'webhook' },
        deps,
      );
      await settle();
      assert.equal(extra.outcome, 'extra');
      assert.equal(sent.length, 1);
    });

    test('a failing mailer still applies the payment', async (t) => {
      const store = make();
      if (!store) return t.skip('no TEST_DATABASE_URL');
      const { userId, orderId, paymentId } = await paidOrder(store);
      const { deps, errors, settle } = harness(store, true);
      const result = await applyPayment(
        { orderId, paymentId, source: 'checkout' },
        deps,
      );
      await settle();
      assert.equal(result.outcome, 'applied');
      assert.ok((await store.getAccount(userId))?.paidUntil);
      assert.deepEqual(errors, ['Premium welcome email failed']);
    });

    test('no mailer set up: the payment applies without email', async (t) => {
      const store = make();
      if (!store) return t.skip('no TEST_DATABASE_URL');
      const { orderId, paymentId } = await paidOrder(store);
      const { deps } = harness(store);
      const result = await applyPayment(
        { orderId, paymentId, source: 'webhook' },
        { ...deps, welcome: undefined },
      );
      assert.equal(result.outcome, 'applied');
    });
  });
}

const memory = new MemoryStore();
emailSuite('memory store', () => memory);

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
emailSuite('postgres store', () => postgres);

describe('welcome email content', () => {
  const email = premiumWelcomeEmail({
    name: '<img src=x onerror=alert(1)>',
    amount: 2000,
    currency: 'USD',
    paymentId: 'pay_ABC123',
    paidUntil: '2026-11-21T10:00:00.000Z',
    appUrl: 'https://canva-room-blush.vercel.app',
  });

  test('escapes the name in HTML', () => {
    assert.ok(!email.html.includes('<img src=x'));
    assert.ok(email.html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  });

  test('shows the payment, the date and where to reach us', () => {
    for (const part of [email.html, email.text]) {
      assert.ok(part.includes('$20.00 USD'));
      assert.ok(part.includes('pay_ABC123'));
      assert.ok(part.includes('21 November 2026'));
      assert.ok(part.includes('canvacollabroom@gmail.com'));
      assert.ok(part.includes('https://canva-room-blush.vercel.app/dashboard'));
      assert.ok(part.includes('/contact#feedback'));
    }
    assert.equal(email.subject, 'Welcome to the CanvaRoom family');
  });
});
