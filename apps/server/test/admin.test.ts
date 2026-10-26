// Admin console operations against Postgres. These cases use a disposable
// database only; never point TEST_DATABASE_URL at production.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';

const databaseUrl = process.env.TEST_DATABASE_URL;
const { migrate } = await import('../src/db.js');
const { MemoryStore } = await import('../src/store.js');
const { PostgresStore } = await import('../src/pg-store.js');

let pool: pg.Pool | undefined;
let store: InstanceType<typeof PostgresStore> | undefined;
let sequence = 0;
const unique = (prefix: string) =>
  `${prefix}${Date.now().toString(36)}${(sequence++).toString(36)}`;

before(async () => {
  if (!databaseUrl) return;
  await migrate(databaseUrl);
  pool = new pg.Pool({ connectionString: databaseUrl, max: 4 });
  store = new PostgresStore(pool, new MemoryStore());
});

after(async () => {
  await pool?.end();
});

async function createUser(fields: { emailVerified?: boolean } = {}) {
  assert.ok(store);
  const id = unique('admin_user_');
  await store.createAccount({
    id,
    email: `${id}@test.invalid`,
    name: 'Admin test',
    color: '#336699',
    createdAt: new Date().toISOString(),
    passwordHash: 'test-only',
    emailVerified: fields.emailVerified ?? false,
  });
  return id;
}

describe('admin console', () => {
  test('verifies an email and drops its pending code', async (t) => {
    if (!store) return t.skip('no TEST_DATABASE_URL');
    const userId = await createUser();
    await store.createVerificationToken(unique('code_'), userId, 600);
    assert.equal(await store.adminVerifyEmail(userId), true);
    assert.equal((await store.getAccount(userId))?.emailVerified, true);
    const { rows } = await pool!.query(
      'SELECT 1 FROM email_verification_tokens WHERE user_id = $1',
      [userId],
    );
    assert.equal(rows.length, 0);
    assert.equal(await store.adminVerifyEmail('missing-user'), false);
  });

  test('marks a verified email unverified again', async (t) => {
    if (!store) return t.skip('no TEST_DATABASE_URL');
    const userId = await createUser({ emailVerified: true });
    assert.equal(await store.adminUnverifyEmail(userId), true);
    assert.equal((await store.getAccount(userId))?.emailVerified, false);
    assert.equal(await store.adminUnverifyEmail('missing-user'), false);
  });

  test('revokes Premium and remembers the end date it had', async (t) => {
    if (!store) return t.skip('no TEST_DATABASE_URL');
    const userId = await createUser();
    const paidUntil = await store.grantAdminAccess({
      id: unique('grant_'),
      username: 'admin@test.invalid',
      userId,
      months: 3,
      days: 0,
      method: 'complimentary',
    });
    assert.ok(paidUntil);
    const result = await store.adminRevokePremium(userId);
    assert.equal(result.found, true);
    assert.equal(result.found && result.previous, paidUntil);
    assert.equal((await store.getAccount(userId))?.paidUntil, undefined);
  });

  test('deleting an account removes its boards but keeps payments', async (t) => {
    if (!store) return t.skip('no TEST_DATABASE_URL');
    const userId = await createUser();
    const boardId = unique('board_');
    const now = new Date().toISOString();
    await store.createBoard(
      {
        id: boardId,
        title: 'Doomed',
        ownerId: userId,
        createdAt: now,
        updatedAt: now,
        locked: false,
        inviteToken: unique('inv_'),
        inviteRevoked: false,
        pages: [{ id: 'p1', name: 'Page 1' }],
        members: { [userId]: { role: 'owner', name: 'Admin test' } },
      } as never,
      [],
    );
    const orderId = unique('order_');
    await store.createPayment({
      orderId,
      userId,
      amount: 2500,
      currency: 'USD',
      status: 'created',
      createdAt: now,
    });
    const deleted = await store.adminDeleteAccount(userId);
    assert.deepEqual(deleted?.boards, [boardId]);
    assert.equal(await store.getAccount(userId), undefined);
    assert.equal(await store.getMeta(boardId), undefined);
    assert.ok(await store.getPayment(orderId));
    assert.equal(await store.adminDeleteAccount(userId), undefined);
  });

  test('stores prices per currency and resets them', async (t) => {
    if (!store) return t.skip('no TEST_DATABASE_URL');
    await store.setPlanPrices('USD', [3000, 5000, 8000], 'admin@test.invalid');
    assert.deepEqual((await store.getPlanPrices()).USD, [3000, 5000, 8000]);
    assert.equal((await store.getPlanPrices()).INR, undefined);
    await store.setPlanPrices('USD', null, 'admin@test.invalid');
    assert.equal((await store.getPlanPrices()).USD, undefined);
  });

  test('overview counts accounts, online people and paid revenue', async (t) => {
    if (!store) return t.skip('no TEST_DATABASE_URL');
    const before = await store.adminOverview(150);
    const userId = await createUser({ emailVerified: true });
    await store.recordAccountActivity(userId);
    const orderId = unique('order_');
    await store.createPayment({
      orderId,
      userId,
      amount: 4500,
      currency: 'USD',
      status: 'created',
      plan: 'half-year',
      months: 6,
      days: 15,
      createdAt: new Date().toISOString(),
    });
    await store.recordPayment(
      { orderId, paymentId: unique('pay_'), source: 'webhook' },
      30,
    );
    const overview = await store.adminOverview(150);
    assert.equal(overview.accounts.total, before.accounts.total + 1);
    assert.equal(overview.accounts.online, before.accounts.online + 1);
    const usd = (rows: typeof overview.revenue) =>
      rows.find((row) => row.currency === 'USD');
    assert.equal(
      usd(overview.revenue)!.total,
      (usd(before.revenue)?.total ?? 0) + 4500,
    );
    assert.equal(
      usd(overview.revenue)!.today,
      (usd(before.revenue)?.today ?? 0) + 4500,
    );
    const online = await store.listAdminAccounts('', 100, 0, 'online');
    assert.ok(online.users.some((user) => user.id === userId && user.online));
  });

  test('records admin actions newest first', async (t) => {
    if (!store) return t.skip('no TEST_DATABASE_URL');
    const id = unique('action_');
    await store.logAdminAction({
      id,
      username: 'admin@test.invalid',
      action: 'verify_email',
      userId: 'someone',
    });
    const [latest] = await store.listAdminActions(1);
    assert.equal(latest?.id, id);
    assert.equal(latest?.action, 'verify_email');
  });
});

describe('quick feedback', () => {
  test('is stored and summarised for the admin', async (t) => {
    if (!store) return t.skip('no TEST_DATABASE_URL');
    const userId = await createUser({ emailVerified: true });
    await store.addQuickFeedback({
      id: unique('qf_'),
      userId,
      rating: 2,
      tags: ['lag', 'network'],
      features: ['pdf'],
      message: 'Strokes arrive late in class',
      context: { page: '/dashboard', os: 'Windows', rttMedian: 240 },
    });
    await store.addQuickFeedback({
      id: unique('qf_'),
      userId,
      rating: 5,
      tags: ['smooth'],
      features: ['pdf', 'maths'],
      context: {},
    });
    const overview = await store.feedbackOverview(1);
    assert.ok(overview.totals.answers >= 2);
    assert.ok(overview.ratings.find((row) => row.rating === 2)!.count >= 1);
    assert.ok(overview.tags.some((row) => row.id === 'lag'));
    const pdf = overview.features.find((row) => row.id === 'pdf');
    assert.ok(pdf && pdf.count >= 2);
    const mine = overview.recent.find(
      (row) => row.message === 'Strokes arrive late in class',
    );
    assert.equal(mine?.context.rttMedian, 240);
  });
});
