'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  byUrgency,
  NOTICE_KINDS,
  noticeWhen,
  useNotices,
  type Notice,
} from '../lib/notices';

/**
 * The team's current notice (maintenance, downtime, a repair) at the top of
 * every page, and as a small card on boards. Dismissing hides that version
 * of the notice; editing it in the admin console shows it again.
 */

const DISMISSED_KEY = 'canvaroom.notices.dismissed';

function readDismissed(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '{}');
  } catch {
    return {};
  }
}

export function SiteNotices() {
  const pathname = usePathname();
  const notices = useNotices();
  const [dismissed, setDismissed] = useState<Record<string, string>>({});
  const [now, setNow] = useState(0);

  useEffect(() => {
    setDismissed(readDismissed());
    setNow(Date.now());
    // Keeps "starts in 20 min" current.
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  if (!notices?.length || !now || pathname.startsWith('/admin')) return null;
  const visible = notices
    .filter((notice) => dismissed[notice.id] !== notice.updatedAt)
    .sort(byUrgency);
  const notice: Notice | undefined = visible[0];
  if (!notice) return null;
  const kind = NOTICE_KINDS[notice.kind];
  const when = noticeWhen(notice, now);
  const onBoard = pathname.startsWith('/board/');

  function dismiss() {
    const next = { ...readDismissed(), [notice!.id]: notice!.updatedAt };
    try {
      localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
    } catch {
      // Private mode: it stays hidden until the page reloads.
    }
    setDismissed(next);
  }

  return (
    <div
      className={`site-notice is-${notice.kind} ${onBoard ? 'is-floating' : ''}`}
      role={notice.kind === 'outage' ? 'alert' : 'status'}
    >
      <span className="site-notice-icon" aria-hidden="true">
        {kind.emoji}
      </span>
      <div className="site-notice-body">
        <p>
          <strong>{notice.title}</strong>
          {when && <span className="site-notice-when">{when}</span>}
        </p>
        {notice.message && !onBoard && (
          <p className="site-notice-message">{notice.message}</p>
        )}
      </div>
      <Link href="/status" className="site-notice-link">
        {visible.length > 1 ? `Details (+${visible.length - 1})` : 'Details'}
      </Link>
      <button
        className="site-notice-close"
        aria-label="Hide this notice"
        onClick={dismiss}
      >
        ×
      </button>
    </div>
  );
}
