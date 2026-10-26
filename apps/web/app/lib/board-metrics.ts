'use client';

import { useEffect, useEffectEvent, useRef } from 'react';
import type { ConnectionStats, RealtimeClient } from './realtime';

/**
 * How an open board is performing for this person, summarised once a minute
 * (and when they leave) and sent to the server, which keeps it for the admin
 * console's Performance page and logs the poor ones. Only numbers about the
 * session are sent: nothing that's drawn, typed or said on the board.
 */

const REPORT_EVERY_MS = 60_000;
/** Minutes with less visible time than this aren't worth a report. */
const MIN_VISIBLE_MS = 10_000;

/** A frame that kept the page busy this long feels like a stutter. */
const SLOW_FRAME_MS = 50;

export type BoardReport = {
  boardId: string;
  visibleMs: number;
  rtt: number[];
  saves: number[];
  reconnects: number;
  rejected: number;
  offlineMs: number;
  slowFrames: number;
  slowFrameMs: number;
  worstFrameMs: number;
  errors: number;
  firstError?: string;
  objects: number;
  zoom: number;
  device: {
    mobile: boolean;
    browser: string;
    os: string;
    cores?: number;
    memoryGb?: number;
    network?: string;
    screen: string;
    pixelRatio: number;
  };
};

function describeDevice(): BoardReport['device'] {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /SamsungBrowser/.test(ua)
        ? 'Samsung Internet'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : /Chrome\//.test(ua)
            ? 'Chrome'
            : /Safari\//.test(ua)
              ? 'Safari'
              : 'Other';
  const os = /iPhone|iPad|iPod/.test(ua)
    ? 'iOS'
    : /Android/.test(ua)
      ? 'Android'
      : /Mac OS X/.test(ua)
        ? 'macOS'
        : /Windows/.test(ua)
          ? 'Windows'
          : /CrOS/.test(ua)
            ? 'ChromeOS'
            : /Linux/.test(ua)
              ? 'Linux'
              : 'Other';
  const nav = navigator as Navigator & {
    deviceMemory?: number;
    connection?: { effectiveType?: string };
    userAgentData?: { mobile?: boolean };
  };
  return {
    mobile: nav.userAgentData?.mobile ?? /Mobi|Android|iPhone|iPad/.test(ua),
    browser,
    os,
    ...(nav.hardwareConcurrency ? { cores: nav.hardwareConcurrency } : {}),
    ...(nav.deviceMemory ? { memoryGb: nav.deviceMemory } : {}),
    ...(nav.connection?.effectiveType
      ? { network: nav.connection.effectiveType }
      : {}),
    screen: `${screen.width}x${screen.height}`,
    pixelRatio: Math.round(devicePixelRatio * 100) / 100,
  };
}

/**
 * Watches an open board and reports how it's performing. `objects` and
 * `zoom` are read when a report is sent; `client` supplies the connection's
 * own numbers.
 */
export function useBoardMetrics(options: {
  boardId: string;
  client: React.RefObject<RealtimeClient | null>;
  objects: () => number;
  zoom: () => number;
  enabled: boolean;
}) {
  const { boardId, enabled } = options;
  const frames = useRef({ count: 0, total: 0, worst: 0 });
  const errors = useRef({ count: 0, first: '' });
  const visible = useRef({ ms: 0, since: 0 });

  const report = useEffectEvent((leaving: boolean) => {
    const now = performance.now();
    if (visible.current.since) {
      visible.current.ms += now - visible.current.since;
      visible.current.since = document.visibilityState === 'visible' ? now : 0;
    }
    const connection: ConnectionStats = options.client.current?.takeStats() ?? {
      rtt: [],
      saves: [],
      reconnects: 0,
      rejected: 0,
      offlineMs: 0,
    };
    const visibleMs = Math.round(visible.current.ms);
    const body: BoardReport = {
      boardId,
      visibleMs,
      ...connection,
      slowFrames: frames.current.count,
      slowFrameMs: Math.round(frames.current.total),
      worstFrameMs: Math.round(frames.current.worst),
      errors: errors.current.count,
      ...(errors.current.first ? { firstError: errors.current.first } : {}),
      objects: options.objects(),
      zoom: Math.round(options.zoom() * 100) / 100,
      device: describeDevice(),
    };
    frames.current = { count: 0, total: 0, worst: 0 };
    errors.current = { count: 0, first: '' };
    visible.current.ms = 0;
    // A minute spent mostly in another tab says nothing about the board.
    if (visibleMs < MIN_VISIBLE_MS && !body.errors && !body.reconnects) return;
    const json = JSON.stringify(body);
    try {
      if (leaving && navigator.sendBeacon)
        navigator.sendBeacon(
          '/api/telemetry',
          new Blob([json], { type: 'application/json' }),
        );
      else
        void fetch('/api/telemetry', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: json,
          keepalive: true,
          credentials: 'same-origin',
        }).catch(() => {});
    } catch {
      // Reporting must never get in the way of the board.
    }
  });

  useEffect(() => {
    if (!enabled) return;
    visible.current = {
      ms: 0,
      since: document.visibilityState === 'visible' ? performance.now() : 0,
    };
    const onVisibility = () => {
      const now = performance.now();
      if (document.visibilityState === 'visible') visible.current.since = now;
      else if (visible.current.since) {
        visible.current.ms += now - visible.current.since;
        visible.current.since = 0;
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    // Long animation frames (Chrome) say how long the page froze; older
    // browsers only have long tasks, a close stand-in.
    let observer: PerformanceObserver | undefined;
    const note = (duration: number) => {
      if (duration < SLOW_FRAME_MS) return;
      frames.current.count++;
      frames.current.total += duration;
      frames.current.worst = Math.max(frames.current.worst, duration);
    };
    try {
      const types = PerformanceObserver.supportedEntryTypes ?? [];
      const type = types.includes('long-animation-frame')
        ? 'long-animation-frame'
        : types.includes('longtask')
          ? 'longtask'
          : undefined;
      if (type) {
        observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) note(entry.duration);
        });
        observer.observe({ type, buffered: false });
      }
    } catch {
      observer = undefined;
    }

    const onError = (event: ErrorEvent | PromiseRejectionEvent) => {
      errors.current.count++;
      if (!errors.current.first) {
        const reason =
          'reason' in event
            ? event.reason instanceof Error
              ? event.reason.message
              : String(event.reason)
            : event.message;
        errors.current.first = String(reason).slice(0, 200);
      }
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onError);

    const timer = window.setInterval(() => report(false), REPORT_EVERY_MS);
    const onLeave = () => report(true);
    window.addEventListener('pagehide', onLeave);
    return () => {
      // Leaving the board inside the app sends what's left.
      report(true);
      window.clearInterval(timer);
      window.removeEventListener('pagehide', onLeave);
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onError);
      document.removeEventListener('visibilitychange', onVisibility);
      observer?.disconnect();
    };
  }, [enabled, boardId]);
}
