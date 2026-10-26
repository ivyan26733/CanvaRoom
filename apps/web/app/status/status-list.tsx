'use client';

import { useEffect, useState } from 'react';
import {
  NOTICE_KINDS,
  noticeWhen,
  useNotices,
  type Notice,
} from '../lib/notices';

/** Current notices first, then the last 30 days. */
export function StatusList() {
  const history = useNotices(true);
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  if (!history || !now)
    return <p className="status-empty">Checking for notices…</p>;
  const live = (notice: Notice) =>
    Date.parse(notice.showFrom) <= now &&
    (!notice.showUntil || Date.parse(notice.showUntil) > now);
  const current = history.filter(live);
  const past = history.filter((notice) => !live(notice));

  return (
    <>
      <section className="status-section" aria-labelledby="status-now">
        <h2 id="status-now">Right now</h2>
        {current.length ? (
          <ul className="status-list">
            {current.map((notice) => (
              <NoticeCard key={notice.id} notice={notice} now={now} />
            ))}
          </ul>
        ) : (
          <div className="status-ok">
            <span aria-hidden="true">✅</span>
            <div>
              <strong>All systems running normally</strong>
              <p>No maintenance or known issues at the moment.</p>
            </div>
          </div>
        )}
      </section>
      {past.length > 0 && (
        <section className="status-section" aria-labelledby="status-past">
          <h2 id="status-past">Earlier this month</h2>
          <ul className="status-list is-past">
            {past.map((notice) => (
              <NoticeCard key={notice.id} notice={notice} now={now} />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function NoticeCard({ notice, now }: { notice: Notice; now: number }) {
  const kind = NOTICE_KINDS[notice.kind];
  const when = noticeWhen(notice, now);
  return (
    <li className={`status-card is-${notice.kind}`}>
      <span className="status-badge">
        <span aria-hidden="true">{kind.emoji}</span> {kind.label}
      </span>
      <h3>{notice.title}</h3>
      {when && <p className="status-when">{when}</p>}
      {notice.message && <p className="status-message">{notice.message}</p>}
      <p className="status-posted">
        Posted{' '}
        {new Intl.DateTimeFormat(undefined, {
          day: 'numeric',
          month: 'short',
          hour: 'numeric',
          minute: '2-digit',
        }).format(new Date(notice.showFrom))}
        {notice.updatedAt !== notice.createdAt && notice.createdAt
          ? ' · updated'
          : ''}
      </p>
    </li>
  );
}
