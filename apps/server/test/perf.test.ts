// Board performance reports: summarising what the browser measured, judging
// when a minute was poor, and the admin overview. Postgres cases run when
// TEST_DATABASE_URL points at a disposable database (never production).
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';

const { migrate } = await import('../src/db.js');
const { PostgresStore } = await import('../src/pg-store.js');
const { MemoryStore } = await import('../src/store.js');
const { boardReportSchema, percentile, summarise } =
  await import('../src/perf.js');
type BoardReport = import('../src/perf.js').BoardReport;

let sequence = 0;
const unique = (prefix: string) =>
  `${prefix}${Date.now().toString(36)}${(sequence++).toString(36)}`;

const report = (overrides: Partial<BoardReport> = {}): BoardReport => ({
  boardId: 'board-1',
  visibleMs: 60_000,
  rtt: [40, 45, 50, 60, 55],
  saves: [80, 90],
  reconnects: 0,
  rejected: 0,
  offlineMs: 0,
  slowFrames: 1,
  slowFrameMs: 70,
  worstFrameMs: 70,
  errors: 0,
  objects: 120,
  zoom: 1,
  device: {
    mobile: false,
    browser: 'Chrome',
    os: 'macOS',
    cores: 8,
    screen: '1440x900',
    pixelRatio: 2,
  },
  ...overrides,
});

describe('performance summary', () => {
  test('percentiles', () => {
    assert.equal(percentile([], 0.5), null);
    assert.equal(percentile([30, 10, 20], 0.5), 20);
    assert.equal(
      percentile(
        Array.from({ length: 100 }, (_, i) => i + 1),
        0.95,
      ),
      95,
    );
  });

  test('a smooth minute is not poor', () => {
    const row = summarise(report(), { id: 'r1', userId: 'u', guest: false });
    assert.equal(row.poor, false);
    assert.deepEqual(row.reasons, []);
    assert.equal(row.rttP50, 50);
    assert.equal(row.saves, 2);
  });

  test('lag, freezes, reconnects and errors are named', () => {
    const row = summarise(
      report({
        rtt: [900, 1200, 800],
        saves: [3000],
        slowFrameMs: 2500,
        reconnects: 2,
        offlineMs: 9000,
        errors: 1,
        firstError: 'Cannot read properties of undefined',
      }),
      { id: 'r2', userId: 'u', guest: false, country: 'IN' },
    );
    assert.equal(row.poor, true);
    const text = row.reasons.join(' | ');
    for (const part of [
      'slow connection',
      'slow saves',
      'screen froze',
      '2 reconnects',
      'offline 9 s',
      '1 script error',
    ])
      assert.ok(text.includes(part), `${part} missing from ${text}`);
    assert.equal(row.country, 'IN');
  });

  test('the schema refuses absurd numbers and board content', () => {
    assert.equal(
      boardReportSchema.safeParse({ ...report(), rtt: [-1] }).success,
      false,
    );
    const parsed = boardReportSchema.parse({
      ...report(),
      text: 'what someone wrote on the board',
    });
    assert.equal('text' in parsed, false);
  });
});

const databaseUrl = process.env.TEST_DATABASE_URL;
let pool: pg.Pool | undefined;
let store: InstanceType<typeof PostgresStore> | undefined;
before(async () => {
  if (!databaseUrl) return;
  await migrate(databaseUrl);
  pool = new pg.Pool({ connectionString: databaseUrl, max: 4 });
  store = new PostgresStore(pool, new MemoryStore());
});
after(async () => {
  await pool?.end();
});

describe('performance reports in Postgres', () => {
  test('are stored, summarised for the admin, and purged', async (t) => {
    if (!store || !pool) return t.skip('no TEST_DATABASE_URL');
    const userId = unique('perf_user_');
    const smooth = summarise(report(), {
      id: unique('m_'),
      userId,
      guest: false,
      country: 'IN',
    });
    const laggy = summarise(
      report({
        rtt: [1500, 1800],
        reconnects: 1,
        firstError: 'Boom',
        errors: 1,
      }),
      { id: unique('m_'), userId, guest: false, country: 'US' },
    );
    await store.addBoardMetric(smooth);
    await store.addBoardMetric(laggy);
    const overview = await store.performanceOverview(1);
    assert.ok(overview.totals.reports >= 2);
    assert.ok(overview.totals.poor >= 1);
    const found = overview.worst.find((row) => row.id === laggy.id);
    assert.ok(found);
    assert.ok(
      found.reasons.some((reason: string) => reason.includes('reconnect')),
    );
    assert.ok(overview.errors.some((row) => row.message === 'Boom'));
    assert.ok(overview.devices.some((row) => row.os === 'macOS'));
    assert.ok(overview.countries.some((row) => row.country === 'US'));
    await pool.query(
      `UPDATE board_metrics SET created_at = now() - interval '31 days' WHERE id = $1`,
      [smooth.id],
    );
    assert.ok((await store.purgeBoardMetrics(30)) >= 1);
    const { rows } = await pool.query(
      'SELECT 1 FROM board_metrics WHERE id = $1',
      [smooth.id],
    );
    assert.equal(rows.length, 0);
  });
});
