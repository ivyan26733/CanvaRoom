'use client';

import { useEffect, useState } from 'react';
import { api } from './api';

/** A notice from the team: maintenance, downtime, repairs or news. */
export type Notice = {
  id: string;
  kind: 'maintenance' | 'outage' | 'info' | 'update';
  title: string;
  message: string;
  startsAt: string | null;
  endsAt: string | null;
  showFrom: string;
  showUntil: string | null;
  published: boolean;
  createdBy?: string;
  createdAt?: string;
  updatedAt: string;
};

export const NOTICE_KINDS: Record<
  Notice['kind'],
  { label: string; emoji: string }
> = {
  outage: { label: 'Service issue', emoji: '🚨' },
  maintenance: { label: 'Scheduled maintenance', emoji: '🛠️' },
  update: { label: 'Update', emoji: '✨' },
  info: { label: 'Notice', emoji: '📣' },
};

/** Most urgent first. */
const URGENCY: Notice['kind'][] = ['outage', 'maintenance', 'update', 'info'];
export const byUrgency = (a: Notice, b: Notice) =>
  URGENCY.indexOf(a.kind) - URGENCY.indexOf(b.kind);

/** How often open pages check for new notices. */
const REFRESH_MS = 3 * 60_000;

/** Live notices, refreshed every few minutes and when the tab comes back. */
export function useNotices(history = false) {
  const [notices, setNotices] = useState<Notice[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api<{ notices: Notice[] }>(`/notices${history ? '?history=1' : ''}`)
        .then((result) => !cancelled && setNotices(result.notices))
        .catch(() => !cancelled && setNotices((current) => current ?? []));
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [history]);
  return notices;
}

const dayTime = (value: string) =>
  new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
const timeOnly = (value: string) =>
  new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
const sameDay = (a: string, b: string) =>
  new Date(a).toDateString() === new Date(b).toDateString();

/** "in 3 h 20 min", "in 2 days". */
function until(ms: number) {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return 'any moment';
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24)
    return `in ${hours} h${minutes % 60 ? ` ${minutes % 60} min` : ''}`;
  const days = Math.round(hours / 24);
  return `in ${days} day${days > 1 ? 's' : ''}`;
}

/** When the event happens, in the viewer's own time zone, with a countdown. */
export function noticeWhen(notice: Notice, now = Date.now()) {
  if (!notice.startsAt) return '';
  const start = Date.parse(notice.startsAt);
  const end = notice.endsAt ? Date.parse(notice.endsAt) : null;
  const range = notice.endsAt
    ? `${dayTime(notice.startsAt)} – ${sameDay(notice.startsAt, notice.endsAt) ? timeOnly(notice.endsAt) : dayTime(notice.endsAt)}`
    : dayTime(notice.startsAt);
  if (now < start) return `${range} (your time) · starts ${until(start - now)}`;
  if (end && now < end)
    return `Happening now · until ${timeOnly(notice.endsAt!)} (your time)`;
  if (end) return `Finished · ${range}`;
  return `Since ${dayTime(notice.startsAt)}`;
}
