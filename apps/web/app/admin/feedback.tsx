'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../lib/api';
import {
  chipLabel,
  FEATURE_CHIPS,
  PRAISE_CHIPS,
  PROBLEM_CHIPS,
} from '../lib/feedback-chips';

/**
 * What people said: star ratings and one-tap answers from the in-app prompt,
 * plus messages from the feedback form.
 */

type Overview = {
  days: number;
  totals: {
    answers: number;
    people: number;
    average: number | null;
    happy: number;
    unhappy: number;
  };
  ratings: { rating: number; count: number }[];
  tags: { id: string; count: number; average: number }[];
  features: { id: string; count: number }[];
  recent: {
    id: string;
    at: string;
    rating: number;
    tags: string[];
    features: string[];
    message: string | null;
    context: Record<string, string | number | boolean | null>;
    name: string | null;
    email: string | null;
  }[];
  messages: {
    id: string;
    at: string;
    email: string;
    name: string | null;
    category: string;
    rating: number | null;
    message: string;
    page: string | null;
  }[];
};

const RANGES = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 365, label: '1 year' },
];

const when = (value: string) =>
  new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));

const stars = (rating: number) =>
  '★'.repeat(rating) + '☆'.repeat(Math.max(0, 5 - rating));

const PROBLEMS = new Set(PROBLEM_CHIPS.map((chip) => chip.id));
const PRAISE = new Set(PRAISE_CHIPS.map((chip) => chip.id));

export function FeedbackSection({
  onUnauthorized,
}: {
  onUnauthorized: () => void;
}) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setData(await api<Overview>(`/admin/feedback?days=${days}`));
      setError('');
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) onUnauthorized();
      setError(
        caught instanceof Error ? caught.message : 'Could not load feedback.',
      );
    }
  }, [days, onUnauthorized]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = data?.totals;
  const maxRating = Math.max(1, ...(data?.ratings ?? []).map((r) => r.count));
  const problems = (data?.tags ?? []).filter((tag) => PROBLEMS.has(tag.id));
  const praise = (data?.tags ?? []).filter((tag) => PRAISE.has(tag.id));

  return (
    <>
      <section className="admin-heading">
        <div>
          <span className="kicker">Voice of users</span>
          <h1 className="admin-title">Feedback</h1>
          <p>
            Star ratings and one-tap answers from the in-app prompt, and
            messages from the feedback form.
          </p>
        </div>
        <div className="admin-segment" role="tablist" aria-label="Time range">
          {RANGES.map((range) => (
            <button
              key={range.days}
              role="tab"
              aria-selected={days === range.days}
              className={days === range.days ? 'is-active' : ''}
              onClick={() => setDays(range.days)}
            >
              {range.label}
            </button>
          ))}
        </div>
      </section>
      {error && (
        <div className="admin-alert" role="alert">
          {error}
        </div>
      )}

      <section className="admin-kpis is-four" aria-label="Summary">
        <div className="admin-kpi">
          <span>Average rating</span>
          <strong>
            {totals?.average != null ? `${totals.average.toFixed(1)} ★` : '—'}
          </strong>
          <small>{totals?.answers ?? 0} answers</small>
        </div>
        <div className="admin-kpi">
          <span>People who answered</span>
          <strong>{totals?.people ?? '—'}</strong>
          <small>Signed-in users</small>
        </div>
        <div className="admin-kpi">
          <span>Happy (4–5 ★)</span>
          <strong className="is-good">
            {totals && totals.answers
              ? `${Math.round((totals.happy / totals.answers) * 100)}%`
              : '—'}
          </strong>
          <small>{totals?.happy ?? 0} people</small>
        </div>
        <div className="admin-kpi">
          <span>Unhappy (1–2 ★)</span>
          <strong className={totals?.unhappy ? 'is-bad' : ''}>
            {totals && totals.answers
              ? `${Math.round((totals.unhappy / totals.answers) * 100)}%`
              : '—'}
          </strong>
          <small>Each one is emailed to you</small>
        </div>
      </section>

      <div className="admin-grid is-thirds">
        <section className="admin-card">
          <div className="admin-card-head">
            <h2>Ratings</h2>
          </div>
          <ul className="admin-mix fb-ratings">
            {[...(data?.ratings ?? [])].reverse().map((row) => (
              <li key={row.rating}>
                <span className="fb-stars">{stars(row.rating)}</span>
                <span className="admin-mix-bar">
                  <i
                    style={{
                      width: `${(row.count / maxRating) * 100}%`,
                    }}
                  />
                </span>
                <strong>{row.count}</strong>
              </li>
            ))}
          </ul>
        </section>
        <TagCard
          title="What got in the way"
          rows={problems}
          empty="No problems reported. 🎉"
          tone="is-bad"
        />
        <TagCard
          title="What works well"
          rows={praise}
          empty="No praise picked yet."
          tone="is-good"
        />
      </div>

      <section className="admin-card">
        <div className="admin-card-head">
          <h2>Most-wanted features</h2>
          <span className="admin-secondary">
            {FEATURE_CHIPS.length} options in the prompt
          </span>
        </div>
        <TagCard rows={data?.features ?? []} empty="No requests yet." bare />
      </section>

      <section className="admin-card">
        <div className="admin-card-head">
          <h2>Recent answers</h2>
        </div>
        {data?.recent.length ? (
          <ul className="fb-list">
            {data.recent.map((row) => (
              <li key={row.id}>
                <div className="fb-row-head">
                  <span
                    className={`fb-stars ${row.rating <= 2 ? 'is-bad' : ''}`}
                  >
                    {stars(row.rating)}
                  </span>
                  <strong>{row.name ?? 'Unknown'}</strong>
                  <span className="admin-secondary">{row.email}</span>
                  <span className="admin-secondary fb-when">
                    {when(row.at)}
                  </span>
                </div>
                {(row.tags.length > 0 || row.features.length > 0) && (
                  <div className="fb-tags">
                    {row.tags.map((tag) => (
                      <span
                        key={tag}
                        className={`admin-pill ${PROBLEMS.has(tag) ? 'is-bad' : 'is-good'}`}
                      >
                        {chipLabel(tag)}
                      </span>
                    ))}
                    {row.features.map((feature) => (
                      <span key={feature} className="admin-pill">
                        Wants: {chipLabel(feature)}
                      </span>
                    ))}
                  </div>
                )}
                {row.message && <p className="fb-message">“{row.message}”</p>}
                <p className="admin-secondary">
                  {[
                    row.context.os &&
                      `${row.context.os} · ${row.context.browser}${row.context.mobile ? ' · phone' : ''}`,
                    row.context.country,
                    row.context.plan,
                    row.context.rttMedian != null &&
                      `connection ${row.context.rttMedian} ms`,
                    typeof row.context.slowFrameMs === 'number' &&
                      row.context.slowFrameMs > 0 &&
                      `${row.context.slowFrameMs} ms frozen`,
                    row.context.page,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="admin-muted">
            {data
              ? 'No answers yet. The prompt appears after someone spends about 10 minutes on boards.'
              : 'Loading…'}
          </p>
        )}
      </section>

      <section className="admin-card">
        <div className="admin-card-head">
          <h2>Messages from the feedback form</h2>
        </div>
        {data?.messages.length ? (
          <ul className="fb-list">
            {data.messages.map((row) => (
              <li key={row.id}>
                <div className="fb-row-head">
                  {row.rating && (
                    <span className="fb-stars">{stars(row.rating)}</span>
                  )}
                  <strong>{row.name ?? row.email}</strong>
                  <span className="admin-pill">{row.category}</span>
                  <span className="admin-secondary fb-when">
                    {when(row.at)}
                  </span>
                </div>
                <p className="fb-message">{row.message}</p>
                <p className="admin-secondary">
                  {row.email}
                  {row.page ? ` · ${row.page}` : ''}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="admin-muted">No messages in this period.</p>
        )}
      </section>
    </>
  );
}

function TagCard({
  title,
  rows,
  empty,
  tone = '',
  bare = false,
}: {
  title?: string;
  rows: { id: string; count: number }[];
  empty: string;
  tone?: string;
  bare?: boolean;
}) {
  const max = Math.max(1, ...rows.map((row) => row.count));
  const list = rows.length ? (
    <ul className={`admin-mix fb-tag-bars ${tone}`}>
      {rows.slice(0, 10).map((row) => (
        <li key={row.id}>
          <span>{chipLabel(row.id)}</span>
          <span className="admin-mix-bar">
            <i style={{ width: `${(row.count / max) * 100}%` }} />
          </span>
          <strong>{row.count}</strong>
        </li>
      ))}
    </ul>
  ) : (
    <p className="admin-muted">{empty}</p>
  );
  if (bare) return list;
  return (
    <section className="admin-card">
      <div className="admin-card-head">
        <h2>{title}</h2>
      </div>
      {list}
    </section>
  );
}
