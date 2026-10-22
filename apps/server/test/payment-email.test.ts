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
const { premiumReminderEmail, premiumWelcomeEmail } =
  await import('../src/mail.js');
const { sendRenewalReminders } = await import('../src/payments.js');
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
    term: '6 months + 15 days free',
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
      assert.ok(part.includes('6 months + 15 days free'));
      assert.ok(part.includes('pay_ABC123'));
      assert.ok(part.includes('21 November 2026'));
      assert.ok(part.includes('canvacollabroom@gmail.com'));
      assert.ok(part.includes('https://canva-room-blush.vercel.app/dashboard'));
      assert.ok(part.includes('/contact#feedback'));
    }
    assert.equal(email.subject, 'Welcome to the CanvaRoom family');
  });
});

describe('welcome email plan', () => {
  test('names the plan the order was for', async () => {
    const store = new MemoryStore();
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
      amount: 6500,
      currency: 'USD',
      status: 'created',
      plan: 'yearly',
      months: 13,
      days: 0,
      createdAt: new Date().toISOString(),
    });
    const { deps, sent, settle } = harness(store);
    await applyPayment(
      { orderId, paymentId: unique('pay_'), source: 'webhook' },
      deps,
    );
    await settle();
    assert.equal(sent[0]!.welcome.term, '12 months + 1 month free');
    assert.equal(sent[0]!.welcome.amount, 6500);
  });
});

describe('renewal reminders', () => {
  const DAY = 86_400_000;
  /** An account whose Premium ends `days` from now. */
  async function premiumAccount(store: Store, days: number) {
    const userId = unique('user');
    await store.createAccount({
      id: userId,
      email: `${userId}@test.invalid`,
      name: 'Test',
      color: '#336699',
      createdAt: new Date().toISOString(),
      passwordHash: 'x',
      paidUntil: new Date(Date.now() + days * DAY).toISOString(),
    });
    return userId;
  }

  function reminders(store: Store, fail = false) {
    const sent: string[] = [];
    const errors: string[] = [];
    const deps = {
      store,
      appUrl: 'https://example.test',
      log: {
        ...quiet,
        error: (_: object, message: string) => void errors.push(message),
      },
      remind: async (to: string) => {
        if (fail) throw new Error('SMTP down');
        sent.push(to);
      },
    };
    return { deps, sent, errors };
  }

  test('reminds once per end date, only near the end', async () => {
    const store = new MemoryStore();
    const soon = await premiumAccount(store, 3);
    await premiumAccount(store, 40);
    await premiumAccount(store, -1);
    const first = reminders(store);
    const result = await sendRenewalReminders(first.deps);
    assert.deepEqual(result, { due: 1, sent: 1, failed: 0 });
    assert.deepEqual(first.sent, [`${soon}@test.invalid`]);
    // The next daily run, and a run at the same time, send nothing more.
    const again = reminders(store);
    await Promise.all([
      sendRenewalReminders(again.deps),
      sendRenewalReminders(again.deps),
    ]);
    assert.deepEqual(again.sent, []);
  });

  test('a renewal gets its own reminder before the new end', async () => {
    const store = new MemoryStore();
    const userId = await premiumAccount(store, 2);
    await sendRenewalReminders(reminders(store).deps);
    // Renewed with a legacy one-month order: the new end is 32 days away,
    // so no reminder yet.
    const orderId = unique('order_');
    await store.createPayment({
      orderId,
      userId,
      amount: 2000,
      currency: 'USD',
      status: 'created',
      createdAt: '2026-10-01T00:00:00.000Z',
    });
    await store.recordPayment(
      { orderId, paymentId: unique('pay_'), source: 'webhook' },
      30,
    );
    const later = reminders(store);
    await sendRenewalReminders(later.deps);
    assert.deepEqual(later.sent, []);
    const account = (await store.getAccount(userId))!;
    assert.notEqual(account.premiumRemindedFor, account.paidUntil);
  });

  test('a failed send is retried on the next run', async () => {
    const store = new MemoryStore();
    await premiumAccount(store, 4);
    const failing = reminders(store, true);
    assert.deepEqual(await sendRenewalReminders(failing.deps), {
      due: 1,
      sent: 0,
      failed: 1,
    });
    assert.deepEqual(failing.errors, ['Premium reminder email failed']);
    const retry = reminders(store);
    await sendRenewalReminders(retry.deps);
    assert.equal(retry.sent.length, 1);
  });

  test('postgres claims each reminder once, and again after a renewal', async (t) => {
    if (!postgres || !pool) return t.skip('no TEST_DATABASE_URL');
    // Only this test's accounts: push everyone else's end out of the window.
    const userId = await premiumAccount(postgres, 3);
    await pool.query(`UPDATE accounts SET paid_until = $2 WHERE id = $1`, [
      userId,
      new Date(Date.now() + 3 * DAY).toISOString(),
    ]);
    const runs = await Promise.all(
      Array.from({ length: 4 }, () => postgres!.claimPremiumReminders(5, 1000)),
    );
    const mine = runs.flat().filter((item) => item.userId === userId);
    assert.equal(mine.length, 1);
    // A renewal that still ends inside the window is a new end date.
    await pool.query(
      `UPDATE accounts SET paid_until = paid_until + interval '1 day' WHERE id = $1`,
      [userId],
    );
    const next = await postgres.claimPremiumReminders(5, 1000);
    assert.equal(next.filter((item) => item.userId === userId).length, 1);
    // Unmarked after a failed send, it is claimed again.
    await postgres.releasePremiumReminder(
      userId,
      next.find((item) => item.userId === userId)!.paidUntil,
    );
    const retry = await postgres.claimPremiumReminders(5, 1000);
    assert.equal(retry.filter((item) => item.userId === userId).length, 1);
  });
});

describe('reminder email content', () => {
  const email = premiumReminderEmail({
    name: '<b>x</b>',
    paidUntil: '2026-11-21T10:00:00.000Z',
    appUrl: 'https://canva-room-blush.vercel.app',
  });
  test('says when Premium ends and how to renew', () => {
    assert.equal(
      email.subject,
      'Your CanvaRoom Premium ends on 21 November 2026',
    );
    assert.ok(!email.html.includes('<b>x</b>'));
    for (const part of [email.html, email.text]) {
      assert.ok(part.includes('https://canva-room-blush.vercel.app/#pricing'));
      assert.ok(part.includes('canvacollabroom@gmail.com'));
    }
  });
});
