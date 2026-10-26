// These cases use a disposable database only; never point TEST_DATABASE_URL
// at production.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';

const databaseUrl = process.env.TEST_DATABASE_URL;
const { migrate } = await import('../src/db.js');
const { MemoryStore } = await import('../src/store.js');
const { PostgresStore } = await import('../src/pg-store.js');
const { planById } = await import('../src/plans.js');

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

async function createUser() {
  assert.ok(store);
  const id = unique('bank_user_');
  await store.createAccount({
    id,
    email: `${id}@test.invalid`,
    name: 'Bank transfer test',
    color: '#336699',
    createdAt: new Date().toISOString(),
    passwordHash: 'test-only',
  });
  return id;
}

describe('manual USD bank transfers', () => {
  test('reuses instructions, confirms once, and records the access grant', async (t) => {
    if (!store) return t.skip('no TEST_DATABASE_URL');
    const userId = await createUser();
    const plan = planById('half-year', 'USD')!;
    const first = await store.createBankTransferRequest({
      id: unique('bank_req_'),
      userId,
      plan,
      reference: unique('CR-'),
    });
    assert.ok(first);
    assert.equal(first.status, 'instructions');
    assert.equal(first.amount, 4500);
    assert.equal(first.months, 6);
    assert.equal(first.days, 15);

    const repeated = await store.createBankTransferRequest({
      id: unique('bank_req_'),
      userId,
      plan,
      reference: unique('CR-'),
    });
    assert.equal(repeated?.id, first.id);
    assert.equal(repeated?.reference, first.reference);

    const submitted = await store.submitBankTransferRequest(
      first.id,
      userId,
      'sender-txn-123',
    );
    assert.equal(submitted?.status, 'pending');
    assert.equal(submitted?.senderReference, 'sender-txn-123');
    assert.equal((await store.listAdminBankTransfers()).length, 1);

    const confirmed = await store.confirmBankTransfer(
      first.id,
      'admin@test.invalid',
      unique('grant_'),
    );
    assert.equal(confirmed.outcome, 'confirmed');
    if (confirmed.outcome !== 'confirmed') return;
    const repeatedConfirmation = await store.confirmBankTransfer(
      first.id,
      'admin@test.invalid',
      unique('grant_'),
    );
    assert.equal(repeatedConfirmation.outcome, 'repeat');
    if (repeatedConfirmation.outcome !== 'repeat') return;
    assert.equal(repeatedConfirmation.paidUntil, confirmed.paidUntil);
    assert.equal((await store.listAdminBankTransfers()).length, 0);

    const adminUsers = await store.listAdminAccounts(userId, 10, 0);
    assert.equal(adminUsers.users[0]?.grants.length, 1);
    assert.equal(adminUsers.users[0]?.grants[0]?.method, 'bank_transfer');
    assert.equal(adminUsers.users[0]?.grants[0]?.reference, first.reference);
  });

  test('rejecting a request does not grant Premium', async (t) => {
    if (!store) return t.skip('no TEST_DATABASE_URL');
    const userId = await createUser();
    const request = await store.createBankTransferRequest({
      id: unique('bank_req_'),
      userId,
      plan: planById('quarterly', 'USD')!,
      reference: unique('CR-'),
    });
    assert.ok(request);
    await store.submitBankTransferRequest(request.id, userId);
    const rejected = await store.rejectBankTransfer(
      request.id,
      'admin@test.invalid',
    );
    assert.equal(rejected.outcome, 'rejected');
    assert.equal((await store.getAccount(userId))?.paidUntil, undefined);
  });
});
