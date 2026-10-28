'use client';

import { useEffect, useState } from 'react';

/**
 * One small chart per measure, all on the same time axis, so a spike in one
 * (reconnects, say) can be read straight across to the others (connection
 * speed, poor minutes, whose side). Hovering any chart marks the same moment
 * on all of them.
 */

export type TrendPoint = {
  at: string;
  minutes: number;
  reports: number;
  poor: number;
  poorPercent: number | null;
  rttMedian: number | null;
  rttP95: number | null;
  frozenMs: number;
  reconnects: number;
  backgroundReconnects: number;
  errors: number;
  ours: number;
  user: number;
  unclear: number;
};

type Series = {
  key: keyof TrendPoint;
  label: string;
  color: string;
  /** Drawn as a line instead of bars. */
  line?: boolean;
};

type ChartSpec = {
  title: string;
  /** Headline beside the title, for the whole period. */
  total: (points: TrendPoint[]) => string;
  series: Series[];
  /** Stack the bar series (parts of one whole). */
  stacked?: boolean;
  /** How one value reads in the tooltip. */
  format: (value: number) => string;
  /** Say so when everything is zero, instead of an empty plot. */
  empty: string;
};

const sum = (points: TrendPoint[], key: keyof TrendPoint) =>
  points.reduce((total, point) => total + (Number(point[key]) || 0), 0);
const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
};

const CHARTS: ChartSpec[] = [
  {
    title: 'Board time measured',
    total: (points) => `${sum(points, 'minutes')} min`,
    series: [
      { key: 'minutes', label: 'Minutes on screen', color: 'var(--ink-3)' },
    ],
    format: (value) => `${value} min`,
    empty: 'Nobody used a board in this period.',
  },
  {
    title: 'Typical connection',
    total: (points) => {
      const typical = median(
        points.flatMap((point) =>
          point.rttMedian === null ? [] : [point.rttMedian],
        ),
      );
      return typical === null ? '—' : `${typical} ms`;
    },
    series: [
      { key: 'rttMedian', label: 'Typical', color: 'var(--blue)', line: true },
      {
        key: 'rttP95',
        label: 'Slowest 5%',
        color: 'color-mix(in srgb, var(--blue) 40%, transparent)',
        line: true,
      },
    ],
    format: (value) => `${value} ms`,
    empty: 'No connection measured in this period.',
  },
  {
    title: 'Poor minutes',
    total: (points) => {
      const reports = sum(points, 'reports');
      return reports
        ? `${Math.round((sum(points, 'poor') / reports) * 100)}%`
        : '—';
    },
    series: [
      {
        key: 'poorPercent',
        label: '% of minutes poor',
        color: 'var(--danger)',
      },
    ],
    format: (value) => `${value}%`,
    empty: 'No poor minutes. 🎉',
  },
  {
    title: 'Screen freezes',
    total: (points) => `${(sum(points, 'frozenMs') / 1000).toFixed(1)} s`,
    series: [{ key: 'frozenMs', label: 'Time frozen', color: 'var(--accent)' }],
    format: (value) => `${(value / 1000).toFixed(1)} s frozen`,
    empty: 'No screen freezes.',
  },
  {
    title: 'Reconnects',
    total: (points) =>
      `${sum(points, 'reconnects')} · +${sum(points, 'backgroundReconnects')} bg`,
    series: [
      { key: 'reconnects', label: 'On screen', color: 'var(--accent)' },
      {
        key: 'backgroundReconnects',
        label: 'Background tabs (not felt)',
        color: 'var(--line-2)',
      },
    ],
    stacked: true,
    format: (value) => String(value),
    empty: 'No reconnects.',
  },
  {
    title: 'Script errors',
    total: (points) => String(sum(points, 'errors')),
    series: [{ key: 'errors', label: 'Errors', color: 'var(--danger)' }],
    format: (value) => `${value} error${value === 1 ? '' : 's'}`,
    empty: 'No script errors.',
  },
  {
    title: 'Our side vs user side',
    total: (points) =>
      `${sum(points, 'ours')} ours · ${sum(points, 'user')} user`,
    series: [
      { key: 'ours', label: 'Our side', color: 'var(--danger)' },
      { key: 'user', label: 'User side', color: 'var(--blue)' },
      { key: 'unclear', label: 'Unclear', color: 'var(--line-2)' },
    ],
    stacked: true,
    format: (value) => `${value} min`,
    empty: 'No poor minutes to split. 🎉',
  },
];

const WIDTH = 320;
const HEIGHT = 110;

function tickLabel(value: string, bucketHours: number) {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(bucketHours < 24 ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(new Date(value));
}

export function PerfTrends({
  points,
  bucketHours,
}: {
  points: TrendPoint[];
  bucketHours: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [view, setView] = useState<'combined' | 'separate'>('combined');
  useEffect(() => {
    try {
      if (localStorage.getItem(VIEW_KEY) === 'separate') setView('separate');
    } catch {
      // Storage blocked: keep the combined chart.
    }
  }, []);
  const choose = (next: 'combined' | 'separate') => {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      // Storage blocked: the choice lasts until the page reloads.
    }
  };
  if (!points.length) return null;
  const every =
    bucketHours >= 24
      ? 'per day'
      : bucketHours > 1
        ? `per ${bucketHours} hours`
        : 'per hour';
  return (
    <section className="admin-card perf-trends">
      <div className="admin-card-head">
        <h2>Trends</h2>
        <span className="admin-secondary">{every}</span>
        <div className="admin-segment perf-trend-view">
          {(['combined', 'separate'] as const).map((option) => (
            <button
              key={option}
              className={view === option ? 'is-active' : ''}
              onClick={() => choose(option)}
            >
              {option === 'combined' ? 'One chart' : 'Separate'}
            </button>
          ))}
        </div>
      </div>
      {view === 'combined' ? (
        <CombinedTrend points={points} bucketHours={bucketHours} />
      ) : (
        <div className="perf-trend-grid" onMouseLeave={() => setHover(null)}>
          {CHARTS.map((chart) => (
            <TrendChart
              key={chart.title}
              chart={chart}
              points={points}
              bucketHours={bucketHours}
              hover={hover}
              onHover={setHover}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function TrendChart({
  chart,
  points,
  bucketHours,
  hover,
  onHover,
}: {
  chart: ChartSpec;
  points: TrendPoint[];
  bucketHours: number;
  hover: number | null;
  onHover: (index: number | null) => void;
}) {
  const slot = WIDTH / points.length;
  const gap = Math.min(2, slot * 0.25);
  const value = (point: TrendPoint, key: keyof TrendPoint) =>
    Number(point[key]) || 0;
  const bars = chart.series.filter((series) => !series.line);
  const lines = chart.series.filter((series) => series.line);
  const max = Math.max(
    1,
    ...points.map((point) =>
      chart.stacked
        ? bars.reduce((total, series) => total + value(point, series.key), 0)
        : Math.max(...chart.series.map((series) => value(point, series.key))),
    ),
  );
  const y = (amount: number) => HEIGHT - (amount / max) * (HEIGHT - 6);
  const hasData = points.some((point) =>
    chart.series.some((series) => value(point, series.key) > 0),
  );
  const hovered = hover === null ? null : points[hover];

  return (
    <figure className="perf-trend">
      <figcaption>
        <span>
          {chart.title}
          {hovered && <small>{tickLabel(hovered.at, bucketHours)}</small>}
        </span>
        <strong>
          {hovered
            ? chart.series
                .map((series) =>
                  hovered[series.key] === null
                    ? '—'
                    : chart.format(value(hovered, series.key)),
                )
                .join(' · ')
            : chart.total(points)}
        </strong>
      </figcaption>
      <div className="perf-trend-plot">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`${chart.title}: ${chart.total(points)} in this period.`}
        >
          <line
            x1="0"
            x2={WIDTH}
            y1={HEIGHT}
            y2={HEIGHT}
            className="admin-chart-axis"
          />
          {hasData &&
            points.map((point, index) => {
              let base = HEIGHT;
              return bars.map((series) => {
                const amount = value(point, series.key);
                if (!amount) return null;
                const top = chart.stacked
                  ? base - (HEIGHT - y(amount))
                  : y(amount);
                const height = (chart.stacked ? base : HEIGHT) - top;
                if (chart.stacked) base = top;
                return (
                  <rect
                    key={`${index}-${series.key}`}
                    x={index * slot + gap / 2}
                    y={top}
                    width={Math.max(1, slot - gap)}
                    height={Math.max(1, height - (chart.stacked ? 0.6 : 0))}
                    rx={Math.min(2, (slot - gap) / 2)}
                    fill={series.color}
                  />
                );
              });
            })}
          {hasData &&
            lines.map((series) => {
              const path = points
                .map((point, index) =>
                  point[series.key] === null
                    ? null
                    : `${index * slot + slot / 2},${y(value(point, series.key))}`,
                )
                .reduce<string[][]>(
                  (runs, spot) => {
                    // Gaps (no data) break the line instead of joining across.
                    if (spot === null) runs.push([]);
                    else runs.at(-1)!.push(spot);
                    return runs;
                  },
                  [[]],
                )
                .filter((run) => run.length)
                .map((run) =>
                  run.length === 1 ? `M${run[0]}h0.01` : `M${run.join('L')}`,
                )
                .join('');
              return (
                <path
                  key={series.key}
                  d={path}
                  fill="none"
                  stroke={series.color}
                  strokeWidth="2"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
          {hover !== null && (
            <line
              x1={hover * slot + slot / 2}
              x2={hover * slot + slot / 2}
              y1="0"
              y2={HEIGHT}
              className="perf-trend-cursor"
              vectorEffect="non-scaling-stroke"
            />
          )}
          {points.map((point, index) => (
            <rect
              key={point.at}
              x={index * slot}
              y="0"
              width={slot}
              height={HEIGHT}
              fill="transparent"
              onMouseEnter={() => onHover(index)}
            />
          ))}
        </svg>
        {!hasData && <p className="perf-trend-empty">{chart.empty}</p>}
      </div>
      <div className="perf-trend-axis">
        <span>{tickLabel(points[0]!.at, bucketHours)}</span>
        <span>{tickLabel(points.at(-1)!.at, bucketHours)}</span>
      </div>
      {chart.series.length > 1 && (
        <div className="perf-trend-legend">
          {chart.series.map((series) => (
            <span key={series.key}>
              <i style={{ background: series.color }} />
              {series.label}
            </span>
          ))}
        </div>
      )}
    </figure>
  );
}

const VIEW_KEY = 'canvaroom.admin.perfTrendView';

type Measure = {
  key: keyof TrendPoint;
  label: string;
  /** Categorical slot, coloured by --trend-N (validated light and dark). */
  slot: number;
  format: (value: number) => string;
  total: (points: TrendPoint[]) => string;
};

/** Fixed order: a measure keeps its colour whichever lines are switched off. */
const MEASURES: Measure[] = [
  {
    key: 'minutes',
    label: 'Board time',
    slot: 1,
    format: (value) => `${value} min`,
    total: (points) => `${sum(points, 'minutes')} min`,
  },
  {
    key: 'rttMedian',
    label: 'Typical connection',
    slot: 2,
    format: (value) => `${value} ms`,
    total: CHARTS[1]!.total,
  },
  {
    key: 'poorPercent',
    label: 'Poor minutes',
    slot: 3,
    format: (value) => `${value}%`,
    total: CHARTS[2]!.total,
  },
  {
    key: 'frozenMs',
    label: 'Screen freezes',
    slot: 4,
    format: (value) => `${(value / 1000).toFixed(1)} s`,
    total: CHARTS[3]!.total,
  },
  {
    key: 'reconnects',
    label: 'Reconnects',
    slot: 5,
    format: (value) => String(value),
    total: (points) => String(sum(points, 'reconnects')),
  },
  {
    key: 'errors',
    label: 'Script errors',
    slot: 6,
    format: (value) => String(value),
    total: CHARTS[5]!.total,
  },
  {
    key: 'ours',
    label: 'Our side',
    slot: 7,
    format: (value) => `${value} min`,
    total: (points) => `${sum(points, 'ours')} min`,
  },
  {
    key: 'user',
    label: 'User side',
    slot: 8,
    format: (value) => `${value} min`,
    total: (points) => `${sum(points, 'user')} min`,
  },
];

const C_WIDTH = 960;
const C_HEIGHT = 240;

/**
 * Every measure on one chart. Their units differ (minutes, ms, %, seconds,
 * counts), so each line is drawn against its own peak in the period: the top
 * of the chart is "the most it reached". Lines rising together moved
 * together; the real values are in the legend and on hover.
 */
function CombinedTrend({
  points,
  bucketHours,
}: {
  points: TrendPoint[];
  bucketHours: number;
}) {
  const [hidden, setHidden] = useState<Set<keyof TrendPoint>>(new Set());
  const [hover, setHover] = useState<number | null>(null);
  const [focus, setFocus] = useState<keyof TrendPoint | null>(null);
  const slot = C_WIDTH / points.length;
  const x = (index: number) => index * slot + slot / 2;
  const hovered = hover === null ? null : points[hover];
  const peak = (key: keyof TrendPoint) =>
    Math.max(0, ...points.map((point) => Number(point[key]) || 0));

  return (
    <div className="perf-combined">
      <div className="perf-combined-legend" role="group" aria-label="Measures">
        {MEASURES.map((measure) => {
          const off = hidden.has(measure.key);
          const value = hovered?.[measure.key];
          return (
            <button
              key={measure.key}
              type="button"
              aria-pressed={!off}
              className={`perf-combined-chip ${off ? 'is-off' : ''}`}
              onClick={() =>
                setHidden((current) => {
                  const next = new Set(current);
                  if (next.has(measure.key)) next.delete(measure.key);
                  else next.add(measure.key);
                  return next;
                })
              }
              title={off ? 'Show this line' : 'Hide this line'}
              onMouseEnter={() => setFocus(off ? null : measure.key)}
              onMouseLeave={() => setFocus(null)}
              onFocus={() => setFocus(off ? null : measure.key)}
              onBlur={() => setFocus(null)}
            >
              <i style={{ background: `var(--trend-${measure.slot})` }} />
              <span>{measure.label}</span>
              <strong>
                {hovered
                  ? value === null || value === undefined
                    ? '—'
                    : measure.format(Number(value))
                  : measure.total(points)}
              </strong>
            </button>
          );
        })}
      </div>
      <div className="perf-combined-plot" onMouseLeave={() => setHover(null)}>
        <span className="perf-combined-scale">
          Each line against its own peak
          {hovered && <> · {tickLabel(hovered.at, bucketHours)}</>}
        </span>
        <svg
          viewBox={`0 0 ${C_WIDTH} ${C_HEIGHT}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`Trends: ${MEASURES.map((m) => `${m.label} ${m.total(points)}`).join(', ')}.`}
        >
          {[0.25, 0.5, 0.75].map((share) => (
            <line
              key={share}
              x1="0"
              x2={C_WIDTH}
              y1={C_HEIGHT * share}
              y2={C_HEIGHT * share}
              className="perf-combined-grid"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <line
            x1="0"
            x2={C_WIDTH}
            y1={C_HEIGHT}
            y2={C_HEIGHT}
            className="admin-chart-axis"
            vectorEffect="non-scaling-stroke"
          />
          {MEASURES.filter((measure) => !hidden.has(measure.key))
            .sort((a, b) => Number(a.key === focus) - Number(b.key === focus))
            .map((measure) => {
              const top = peak(measure.key);
              if (!top) return null;
              const y = (value: number) =>
                C_HEIGHT - (value / top) * (C_HEIGHT - 8) - 1;
              const path = points
                .map((point, index) =>
                  point[measure.key] === null
                    ? null
                    : `${x(index)},${y(Number(point[measure.key]) || 0)}`,
                )
                .reduce<string[][]>(
                  (runs, spot) => {
                    if (spot === null) runs.push([]);
                    else runs.at(-1)!.push(spot);
                    return runs;
                  },
                  [[]],
                )
                .filter((run) => run.length)
                .map((run) =>
                  run.length === 1 ? `M${run[0]}h0.01` : `M${run.join('L')}`,
                )
                .join('');
              return (
                <path
                  key={measure.key}
                  d={path}
                  fill="none"
                  stroke={`var(--trend-${measure.slot})`}
                  strokeWidth={focus === measure.key ? 3 : 2}
                  opacity={focus && focus !== measure.key ? 0.12 : 1}
                  className="perf-combined-line"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
          {hover !== null && (
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1="0"
              y2={C_HEIGHT}
              className="perf-trend-cursor"
              vectorEffect="non-scaling-stroke"
            />
          )}
          {points.map((point, index) => (
            <rect
              key={point.at}
              x={index * slot}
              y="0"
              width={slot}
              height={C_HEIGHT}
              fill="transparent"
              onMouseEnter={() => setHover(index)}
            />
          ))}
        </svg>
        {hovered && (
          <div className="perf-combined-dots" aria-hidden="true">
            {MEASURES.filter(
              (measure) =>
                !hidden.has(measure.key) &&
                hovered[measure.key] !== null &&
                peak(measure.key) > 0,
            ).map((measure) => (
              <i
                key={measure.key}
                style={{
                  left: `${((hover! + 0.5) / points.length) * 100}%`,
                  top: `${100 - ((Number(hovered[measure.key]) || 0) / peak(measure.key)) * ((C_HEIGHT - 8) / C_HEIGHT) * 100}%`,
                  background: `var(--trend-${measure.slot})`,
                }}
              />
            ))}
          </div>
        )}
      </div>
      <div className="perf-trend-axis">
        <span>{tickLabel(points[0]!.at, bucketHours)}</span>
        <span>
          {hovered
            ? 'Values above are for this moment'
            : 'Hover to read every measure at one moment · click a measure to hide it'}
        </span>
        <span>{tickLabel(points.at(-1)!.at, bucketHours)}</span>
      </div>
    </div>
  );
}
