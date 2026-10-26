'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, api } from '../lib/api';

/**
 * How boards are performing for people: connection speed, save delays,
 * screen freezes, reconnects and script errors, from the reports each open
 * board sends once a minute. "Poor" minutes are the ones worth a look.
 */

type Overview = {
  hours: number;
  totals: {
    reports: number;
    people: number;
    boards: number;
    poor: number;
    minutes: number;
    rttMedian: number | null;
    rttP95: number | null;
    saveP95: number | null;
    slowFrames: number;
    reconnects: number;
    errors: number;
  };
  devices: {
    os: string;
    browser: string;
    mobile: boolean;
    reports: number;
    people: number;
    rttMedian: number | null;
    freezeMsPerMin: number | null;
    poorPercent: number;
  }[];
  countries: {
    country: string;
    reports: number;
    people: number;
    rttMedian: number | null;
    poorPercent: number;
  }[];
  worst: {
    id: string;
    at: string;
    userId: string;
    guest: boolean;
    name: string | null;
    email: string | null;
    boardId: string;
    boardTitle: string | null;
    rttP95: number | null;
    saveP95: number | null;
    slowFrameMs: number;
    worstFrameMs: number;
    reconnects: number;
    offlineMs: number;
    errors: number;
    firstError: string | null;
    objects: number;
    zoom: number | null;
    mobile: boolean;
    browser: string;
    os: string;
    cores: number | null;
    memoryGb: number | null;
    network: string | null;
    country: string | null;
    reasons: string[];
    side: Side;
    why: string[];
  }[];
  errors: {
    message: string;
    reports: number;
    people: number;
    lastSeen: string;
  }[];
  hourly: {
    hour: string;
    reports: number;
    poor: number;
    rttMedian: number | null;
  }[];
  sides: Record<Side, number>;
  versions: Release[];
  onlyVersion: string | null;
};

type Side = 'ours' | 'user' | 'unclear';
type Release = {
  version: string;
  firstSeen: string;
  message: string | null;
  reports: number;
  poor: number;
};

const SIDES: Record<Side, { label: string; hint: string }> = {
  ours: {
    label: 'Our side',
    hint: 'Our app, server or an update we released. Worth fixing.',
  },
  user: {
    label: 'User side',
    hint: 'Their network or a low-powered device.',
  },
  unclear: {
    label: 'Unclear',
    hint: 'A single short drop. Usually their network.',
  },
};

const RANGES = [
  { hours: 1, label: '1 hour' },
  { hours: 24, label: '24 hours' },
  { hours: 168, label: '7 days' },
  { hours: 720, label: '30 days' },
];

/** Plain-language verdict on a connection time. */
function speed(ms: number | null | undefined) {
  if (ms === null || ms === undefined) return { label: '—', tone: '' };
  if (ms < 150) return { label: `${ms} ms · fast`, tone: 'is-good' };
  if (ms < 400) return { label: `${ms} ms · okay`, tone: 'is-waiting' };
  return { label: `${ms} ms · slow`, tone: 'is-bad' };
}

const when = (value: string) =>
  new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));

const flag = (country: string) =>
  /^[A-Z]{2}$/.test(country)
    ? String.fromCodePoint(
        ...[...country].map((char) => 0x1f1e6 + char.charCodeAt(0) - 65),
      )
    : '🌐';

export function PerformanceSection({
  onUnauthorized,
}: {
  onUnauthorized: () => void;
}) {
  const [hours, setHours] = useState(24);
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState('');
  const [showAll, setShowAll] = useState(false);
  /** 'all', 'latest', or one version's commit. */
  const [version, setVersion] = useState('all');
  const [side, setSide] = useState<Side | 'all'>('all');

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ hours: String(hours) });
      if (version !== 'all') params.set('version', version);
      setData(await api<Overview>(`/admin/performance?${params}`));
      setError('');
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) onUnauthorized();
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not load performance.',
      );
    }
  }, [hours, version, onUnauthorized]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const totals = data?.totals;
  const worst = (data?.worst ?? []).filter(
    (row) => side === 'all' || row.side === side,
  );
  const poorPercent =
    totals && totals.reports
      ? Math.round((totals.poor / totals.reports) * 100)
      : 0;

  return (
    <>
      <section className="admin-heading">
        <div>
          <span className="kicker">Board health</span>
          <h1 className="admin-title">Performance</h1>
          <p>
            How boards feel for people: lag, freezes, dropped connections and
            errors. Each open board reports once a minute.
          </p>
        </div>
        <div className="perf-filters">
          <label className="perf-version">
            <span>Version</span>
            <select
              value={version}
              onChange={(event) => setVersion(event.target.value)}
            >
              <option value="all">All versions</option>
              <option value="latest">Latest version only</option>
              {(data?.versions ?? []).map((release) => (
                <option key={release.version} value={release.version}>
                  {release.version} · {release.message ?? 'update'} (
                  {when(release.firstSeen)})
                </option>
              ))}
            </select>
          </label>
          <div className="admin-segment" role="tablist" aria-label="Time range">
            {RANGES.map((range) => (
              <button
                key={range.hours}
                role="tab"
                aria-selected={hours === range.hours}
                className={hours === range.hours ? 'is-active' : ''}
                onClick={() => setHours(range.hours)}
              >
                {range.label}
              </button>
            ))}
          </div>
        </div>
      </section>
      {error && (
        <div className="admin-alert" role="alert">
          {error}
        </div>
      )}

      <section className="admin-kpis is-even" aria-label="Summary">
        <div className="admin-kpi">
          <span>Board time measured</span>
          <strong>{totals ? `${totals.minutes} min` : '—'}</strong>
          <small>
            {totals?.people ?? 0} {totals?.people === 1 ? 'person' : 'people'}{' '}
            on {totals?.boards ?? 0} board{totals?.boards === 1 ? '' : 's'}
          </small>
        </div>
        <div className="admin-kpi">
          <span>Typical connection</span>
          <strong className={speed(totals?.rttMedian).tone}>
            {totals?.rttMedian != null ? `${totals.rttMedian} ms` : '—'}
          </strong>
          <small>
            Slowest 5%: {totals?.rttP95 != null ? `${totals.rttP95} ms` : '—'}
          </small>
        </div>
        <div className="admin-kpi">
          <span>Poor minutes</span>
          <strong className={poorPercent > 10 ? 'is-bad' : ''}>
            {totals ? `${poorPercent}%` : '—'}
          </strong>
          <small>
            {totals?.poor ?? 0} of {totals?.reports ?? 0} minutes
          </small>
        </div>
        <div className="admin-kpi">
          <span>Screen freezes</span>
          <strong>{totals?.slowFrames ?? '—'}</strong>
          <small>Frames slower than 50 ms</small>
        </div>
        <div className="admin-kpi">
          <span>Reconnects</span>
          <strong>{totals?.reconnects ?? '—'}</strong>
          <small>Dropped connections</small>
        </div>
        <div className="admin-kpi">
          <span>Script errors</span>
          <strong className={totals?.errors ? 'is-bad' : ''}>
            {totals?.errors ?? '—'}
          </strong>
          <small>Crashes on a board</small>
        </div>
      </section>

      <section className="admin-card">
        <div className="admin-card-head">
          <h2>Minutes on boards, smooth and poor</h2>
          <span className="admin-legend">
            <i className="is-smooth" /> Smooth <i className="is-poor" /> Poor{' '}
            <i className="is-release" /> Update released
          </span>
        </div>
        <HourlyChart
          hourly={data?.hourly ?? []}
          releases={data?.versions ?? []}
        />
      </section>

      <section className="admin-card admin-perf-worst">
        <div className="admin-card-head">
          <h2>Recent poor minutes</h2>
          <span className="admin-secondary">
            Search the user or board ID in Vercel logs for “perf”
          </span>
        </div>
        <div className="perf-sides" role="group" aria-label="Whose side">
          <button
            className={`perf-side ${side === 'all' ? 'is-active' : ''}`}
            onClick={() => setSide('all')}
          >
            <strong>{totals?.poor ?? 0}</strong>
            <span>All poor minutes</span>
          </button>
          {(Object.keys(SIDES) as Side[]).map((key) => (
            <button
              key={key}
              className={`perf-side is-${key} ${side === key ? 'is-active' : ''}`}
              onClick={() => setSide(key)}
              title={SIDES[key].hint}
            >
              <strong>{data?.sides[key] ?? 0}</strong>
              <span>{SIDES[key].label}</span>
              <small>{SIDES[key].hint}</small>
            </button>
          ))}
        </div>
        {worst.length ? (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Who</th>
                  <th>Board</th>
                  <th>What went wrong</th>
                  <th>Whose side</th>
                  <th>Device</th>
                </tr>
              </thead>
              <tbody>
                {(showAll ? worst : worst.slice(0, 8)).map((row) => (
                  <tr key={row.id}>
                    <td>{when(row.at)}</td>
                    <td>
                      <strong>
                        {row.name ?? (row.guest ? 'Guest' : 'Unknown')}
                      </strong>
                      <span className="admin-secondary">
                        {row.email ?? row.userId}
                      </span>
                    </td>
                    <td>
                      <strong>{row.boardTitle ?? 'Deleted board'}</strong>
                      <span className="admin-secondary">
                        {row.objects} items · zoom {row.zoom ?? 1}×
                      </span>
                    </td>
                    <td>
                      <ul className="admin-reasons">
                        {row.reasons.map((reason) => (
                          <li key={reason}>{reason}</li>
                        ))}
                      </ul>
                      {row.firstError && (
                        <code title={row.firstError}>{row.firstError}</code>
                      )}
                    </td>
                    <td>
                      <span className={`perf-badge is-${row.side}`}>
                        {SIDES[row.side].label}
                      </span>
                      <ul className="admin-reasons perf-why">
                        {row.why.map((reason) => (
                          <li key={reason}>{reason}</li>
                        ))}
                      </ul>
                    </td>
                    <td>
                      <strong>
                        {row.os} · {row.browser}
                        {row.mobile ? ' · phone' : ''}
                      </strong>
                      <span className="admin-secondary">
                        {[
                          row.country && `${flag(row.country)} ${row.country}`,
                          row.cores && `${row.cores} cores`,
                          row.memoryGb && `${row.memoryGb} GB`,
                          row.network,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {worst.length > 8 && (
              <button
                className="button ghost small admin-show-more"
                onClick={() => setShowAll((current) => !current)}
              >
                {showAll
                  ? 'Show fewer'
                  : `Show all ${worst.length} recent poor minutes`}
              </button>
            )}
          </div>
        ) : (
          <p className="admin-muted">
            {data
              ? side === 'all'
                ? 'No poor minutes in this period. Boards are running smoothly.'
                : `No ${SIDES[side].label.toLowerCase()} problems in this period.`
              : 'Loading…'}
          </p>
        )}
      </section>

      <div className="admin-grid is-even">
        <section className="admin-card">
          <div className="admin-card-head">
            <h2>By device</h2>
          </div>
          <BreakdownTable
            rows={(data?.devices ?? []).map((row) => ({
              key: `${row.os}-${row.browser}-${row.mobile}`,
              label: `${row.os} · ${row.browser}${row.mobile ? ' · phone' : ''}`,
              people: row.people,
              rtt: row.rttMedian,
              poorPercent: row.poorPercent,
              extra:
                row.freezeMsPerMin != null
                  ? `${row.freezeMsPerMin} ms frozen / min`
                  : '',
            }))}
          />
        </section>
        <section className="admin-card">
          <div className="admin-card-head">
            <h2>By country</h2>
          </div>
          <BreakdownTable
            rows={(data?.countries ?? []).map((row) => ({
              key: row.country,
              label: `${flag(row.country)} ${row.country === '??' ? 'Unknown' : row.country}`,
              people: row.people,
              rtt: row.rttMedian,
              poorPercent: row.poorPercent,
              extra: '',
            }))}
          />
        </section>
      </div>

      <section className="admin-card">
        <div className="admin-card-head">
          <h2>By version</h2>
          <span className="admin-secondary">
            Did an update make things better or worse?
          </span>
        </div>
        {data?.versions.length ? (
          <ul className="admin-breakdown">
            {data.versions.map((release, index) => (
              <li key={release.version}>
                <span>
                  <strong>
                    {release.message ?? 'Update'}{' '}
                    {index === 0 && (
                      <span className="admin-pill is-good">Latest</span>
                    )}
                  </strong>
                  <small>
                    {release.version} · released {when(release.firstSeen)} ·{' '}
                    {release.reports} min measured
                  </small>
                </span>
                <span className="admin-pill">{release.poor} poor</span>
                <span
                  className={`admin-poor ${release.reports && release.poor / release.reports > 0.1 ? 'is-bad' : ''}`}
                >
                  {release.reports
                    ? `${Math.round((release.poor / release.reports) * 100)}% poor`
                    : '—'}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="admin-muted">
            Versions appear here from the next update onwards, as people open
            boards on it.
          </p>
        )}
      </section>

      <section className="admin-card">
        <div className="admin-card-head">
          <h2>Script errors on boards</h2>
        </div>
        {data?.errors.length ? (
          <ul className="admin-error-list">
            {data.errors.map((row) => (
              <li key={row.message}>
                <code>{row.message}</code>
                <span>
                  {row.reports} time{row.reports === 1 ? '' : 's'} ·{' '}
                  {row.people} {row.people === 1 ? 'person' : 'people'} · last{' '}
                  {when(row.lastSeen)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="admin-muted">No script errors in this period.</p>
        )}
      </section>
    </>
  );
}

function BreakdownTable({
  rows,
}: {
  rows: {
    key: string;
    label: string;
    people: number;
    rtt: number | null;
    poorPercent: number;
    extra: string;
  }[];
}) {
  if (!rows.length) return <p className="admin-muted">No reports yet.</p>;
  return (
    <ul className="admin-breakdown">
      {rows.map((row) => {
        const verdict = speed(row.rtt);
        return (
          <li key={row.key}>
            <span>
              <strong>{row.label}</strong>
              <small>
                {row.people} {row.people === 1 ? 'person' : 'people'}
                {row.extra ? ` · ${row.extra}` : ''}
              </small>
            </span>
            <span className={`admin-pill ${verdict.tone}`}>
              {verdict.label}
            </span>
            <span
              className={`admin-poor ${row.poorPercent > 10 ? 'is-bad' : ''}`}
            >
              {row.poorPercent}% poor
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Minutes per hour, the poor ones stacked on top in the alert colour. */
function HourlyChart({
  hourly,
  releases,
}: {
  hourly: Overview['hourly'];
  releases: Release[];
}) {
  const [hover, setHover] = useState<number | null>(null);
  const bars = useMemo(() => hourly.slice(-48), [hourly]);
  if (!bars.length)
    return (
      <p className="admin-muted">
        No reports yet. They start arriving a minute after someone opens a
        board.
      </p>
    );
  const width = 600;
  const height = 140;
  const gap = 3;
  const slot = width / bars.length;
  const barWidth = Math.max(2, slot - gap);
  const max = Math.max(...bars.map((bar) => bar.reports), 1);
  return (
    <div className="admin-chart" onMouseLeave={() => setHover(null)}>
      <svg
        viewBox={`0 0 ${width} ${height + 2}`}
        role="img"
        aria-label={`Minutes on boards per hour: ${bars.reduce((sum, bar) => sum + bar.reports, 0)} in total, ${bars.reduce((sum, bar) => sum + bar.poor, 0)} poor.`}
      >
        <line
          x1="0"
          x2={width}
          y1={height}
          y2={height}
          className="admin-chart-axis"
        />
        {bars.map((bar, index) => {
          const x = index * slot + gap / 2;
          const total = (bar.reports / max) * (height - 6);
          const poor = (bar.poor / max) * (height - 6);
          return (
            <g key={bar.hour}>
              <rect
                x={index * slot}
                y="0"
                width={slot}
                height={height}
                fill="transparent"
                onMouseEnter={() => setHover(index)}
              />
              <rect
                className="admin-chart-bar is-smooth"
                x={x}
                y={height - total}
                width={barWidth}
                height={Math.max(0, total - poor - (poor ? 2 : 0))}
                rx="2"
                pointerEvents="none"
              />
              {poor > 0 && (
                <rect
                  className="admin-chart-bar is-poor"
                  x={x}
                  y={height - poor}
                  width={barWidth}
                  height={poor}
                  rx="2"
                  pointerEvents="none"
                />
              )}
            </g>
          );
        })}
        {releases.map((release) => {
          // The bar for the hour it shipped in; bars exist only for hours
          // with reports, so the marker sits inside the right one.
          const at = Date.parse(release.firstSeen);
          let index = -1;
          bars.forEach((bar, position) => {
            if (Date.parse(bar.hour) <= at) index = position;
          });
          const hourStart = index >= 0 ? Date.parse(bars[index]!.hour) : NaN;
          if (index < 0 || at - hourStart >= 3_600_000) return null;
          const x = (index + (at - hourStart) / 3_600_000) * slot;
          return (
            <g key={release.version} className="perf-release">
              <line x1={x} x2={x} y1={0} y2={height} />
              <title>{`Update ${release.version}: ${release.message ?? ''}`}</title>
            </g>
          );
        })}
      </svg>
      <div className="admin-chart-ends">
        <span>{when(bars[0]!.hour)}</span>
        <span>{when(bars.at(-1)!.hour)}</span>
      </div>
      {hover !== null && bars[hover] && (
        <div
          className="admin-chart-tip"
          style={{ left: `${((hover + 0.5) / bars.length) * 100}%` }}
        >
          <strong>
            {bars[hover].reports} min · {bars[hover].poor} poor
          </strong>
          <span>
            {when(bars[hover].hour)}
            {bars[hover].rttMedian != null
              ? ` · ${bars[hover].rttMedian} ms`
              : ''}
          </span>
        </div>
      )}
    </div>
  );
}
