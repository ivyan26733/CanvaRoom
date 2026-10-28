// Board performance reports: summarising what the browser measured, judging
// when a minute was poor, and the admin overview. Postgres cases run when
// TEST_DATABASE_URL points at a disposable database (never production).
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';

const { migrate } = await import('../src/db.js');
const { PostgresStore } = await import('../src/pg-store.js');
const { MemoryStore } = await import('../src/store.js');
const { boardReportSchema, classifyPoor, percentile, summarise } =
  await import('../src/perf.js');
type PoorMinute = import('../src/perf.js').PoorMinute;
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

  test('a minute nobody saw is never poor', () => {
    const hidden = summarise(
      report({ visibleMs: 0, reconnects: 1, offlineMs: 16_000 }),
      { id: 'bg', userId: 'u', guest: false },
    );
    assert.equal(hidden.poor, false);
    // The reasons are still kept, for the background figure.
    assert.ok(hidden.reasons.some((reason) => reason.includes('reconnect')));
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

describe('whose problem a poor minute was', () => {
  const minute = (overrides: Partial<PoorMinute>): PoorMinute => ({
    id: Math.random().toString(36).slice(2),
    at: Date.parse('2026-10-27T10:00:00Z'),
    userId: 'u1',
    rttP95: 120,
    saveP95: null,
    reconnects: 0,
    offlineMs: 0,
    slowFrameMs: 0,
    worstFrameMs: 0,
    errors: 0,
    rejected: 0,
    objects: 100,
    mobile: false,
    cores: 8,
    memoryGb: 8,
    ...overrides,
  });
  const sideOf = (
    target: PoorMinute,
    all: PoorMinute[],
    releases: number[] = [],
  ) => classifyPoor(all, releases).get(target.id)!;

  test('script errors and refused edits are ours', () => {
    const error = minute({ errors: 1 });
    assert.equal(sideOf(error, [error]).side, 'ours');
    const refused = minute({ rejected: 2 });
    assert.equal(sideOf(refused, [refused]).side, 'ours');
  });

  test('slow saves: ours on a quick connection, theirs on a slow one', () => {
    const quick = minute({ saveP95: 2600, rttP95: 130 });
    assert.equal(sideOf(quick, [quick]).side, 'ours');
    const slow = minute({ saveP95: 2600, rttP95: 1500 });
    assert.equal(sideOf(slow, [slow]).side, 'user');
  });

  test('one person lagging is their network; several at once is ours', () => {
    const alone = minute({ rttP95: 12_000 });
    assert.equal(sideOf(alone, [alone]).side, 'user');
    const a = minute({ userId: 'a', reconnects: 1 });
    const b = minute({ userId: 'b', reconnects: 1, at: a.at + 60_000 });
    const verdict = sideOf(a, [a, b]);
    assert.equal(verdict.side, 'ours');
    assert.match(verdict.why[0]!, /2 people/);
  });

  test('a drop right after an update is ours; a lone short drop is unclear', () => {
    const drop = minute({ reconnects: 1, offlineMs: 1500 });
    assert.equal(sideOf(drop, [drop], [drop.at - 2 * 60_000]).side, 'ours');
    assert.equal(sideOf(drop, [drop]).side, 'unclear');
  });

  test('the same person dropping again and again is ours', () => {
    const base = Date.parse('2026-10-26T16:30:00Z');
    const drops = [0, 2, 4, 6].map((n) =>
      minute({ reconnects: 1, offlineMs: 2000, at: base + n * 60_000 }),
    );
    const verdict = sideOf(drops[1]!, drops);
    assert.equal(verdict.side, 'ours');
    assert.match(verdict.why[0]!, /Dropped 4 times/);
  });

  test('freezes: big boards and normal devices are ours, weak devices theirs', () => {
    const big = minute({ slowFrameMs: 2500, objects: 4000 });
    assert.equal(sideOf(big, [big]).side, 'ours');
    const phone = minute({ slowFrameMs: 2500, mobile: true });
    assert.equal(sideOf(phone, [phone]).side, 'user');
    const laptop = minute({ worstFrameMs: 800 });
    assert.equal(sideOf(laptop, [laptop]).side, 'ours');
  });
});

describe('versions in Postgres', () => {
  test('reports can be narrowed to one version, with sides counted', async (t) => {
    if (!store) return t.skip('no TEST_DATABASE_URL');
    const version = unique('v')
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 30);
    await store.noteAppVersion(version, 'Test release');
    const userId = unique('ver_user_');
    const row = summarise(
      { ...report({ errors: 1, firstError: 'Boom' }), version },
      { id: unique('m_'), userId, guest: false },
    );
    await store.addBoardMetric(row);
    const only = await store.performanceOverview(1, version);
    assert.equal(only.totals.reports, 1);
    assert.equal(only.sides.ours, 1);
    assert.equal(only.worst[0]?.side, 'ours');
    const listed = only.versions.find((item) => item.version === version);
    assert.equal(listed?.message, 'Test release');
    assert.equal(listed?.reports, 1);
  });
});

describe('background tabs in Postgres', () => {
  test('are left out of poor minutes and counted separately', async (t) => {
    if (!store) return t.skip('no TEST_DATABASE_URL');
    const version = unique('bg')
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 30);
    const userId = unique('bg_user_');
    const seen = summarise(
      { ...report({ reconnects: 1, offlineMs: 3000 }), version },
      { id: unique('m_'), userId, guest: false },
    );
    const unseen = summarise(
      {
        ...report({ visibleMs: 0, reconnects: 1, offlineMs: 17_000 }),
        version,
      },
      { id: unique('m_'), userId, guest: false },
    );
    await store.addBoardMetric(seen);
    await store.addBoardMetric(unseen);
    const overview = await store.performanceOverview(1, version);
    assert.equal(overview.totals.reports, 1);
    assert.equal(overview.totals.poor, 1);
    assert.equal(overview.worst.length, 1);
    assert.equal(overview.worst[0]!.id, seen.id);
    assert.equal(overview.background.minutes, 1);
    assert.equal(overview.background.reconnects, 1);
  });
});

describe('performance trend in Postgres', () => {
  test('has a point per bucket with each measure, and sides', async (t) => {
    if (!store) return t.skip('no TEST_DATABASE_URL');
    const version = unique('tr')
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 30);
    const userId = unique('trend_user_');
    await store.addBoardMetric(
      summarise(
        {
          ...report({ errors: 1, slowFrameMs: 300, rtt: [100, 140] }),
          version,
        },
        { id: unique('m_'), userId, guest: false },
      ),
    );
    await store.addBoardMetric(
      summarise(
        { ...report({ visibleMs: 0, reconnects: 1 }), version },
        { id: unique('m_'), userId, guest: false },
      ),
    );
    const { trend } = await store.performanceOverview(24, version);
    assert.equal(trend.bucketHours, 1);
    assert.ok(trend.points.length >= 24 && trend.points.length <= 26);
    const last = trend.points.at(-1)!;
    assert.equal(last.minutes, 1);
    assert.equal(last.errors, 1);
    assert.equal(last.frozenMs, 300);
    assert.equal(last.backgroundReconnects, 1);
    assert.equal(last.poor, 1);
    assert.equal(last.ours, 1);
    assert.equal(last.poorPercent, 100);
    assert.equal(trend.points[0]!.minutes, 0);
    const week = await store.performanceOverview(168, version);
    assert.equal(week.trend.bucketHours, 6);
    const month = await store.performanceOverview(720, version);
    assert.equal(month.trend.bucketHours, 24);
  });
});
