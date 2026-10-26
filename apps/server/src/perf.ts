import { z } from 'zod';

/**
 * Board performance reports: what the browser sends once a minute while a
 * board is open (apps/web/app/lib/board-metrics.ts), how it is summarised for
 * storage, and when it counts as a poor experience worth a look.
 */

const ms = z.number().finite().min(0).max(3_600_000);
const label = (max: number) => z.string().trim().max(max);

export const boardReportSchema = z.object({
  boardId: z.string().min(1).max(100),
  version: z
    .string()
    .regex(/^[a-z0-9]{1,40}$/)
    .optional(),
  visibleMs: ms,
  rtt: z.array(ms).max(500),
  saves: z.array(ms).max(500),
  reconnects: z.number().int().min(0).max(1000),
  rejected: z.number().int().min(0).max(10_000),
  offlineMs: ms,
  slowFrames: z.number().int().min(0).max(100_000),
  slowFrameMs: ms,
  worstFrameMs: ms,
  errors: z.number().int().min(0).max(100_000),
  firstError: label(200).optional(),
  objects: z.number().int().min(0).max(10_000_000),
  zoom: z.number().finite().min(0).max(100),
  device: z.object({
    mobile: z.boolean(),
    browser: label(40),
    os: label(40),
    cores: z.number().int().min(0).max(1024).optional(),
    memoryGb: z.number().min(0).max(1024).optional(),
    network: label(20).optional(),
    screen: label(20),
    pixelRatio: z.number().min(0).max(10),
  }),
});

export type BoardReport = z.infer<typeof boardReportSchema>;

/** Thresholds past which a minute on a board felt bad. */
export const POOR = {
  /** Slowest pings: the board feels laggy for others' strokes. */
  rttP95: 600,
  /** Slowest edit confirmations: "Saving…" lingers. */
  saveP95: 2_000,
  /** Total time the screen froze in a minute. */
  slowFrameMs: 2_000,
  /** One freeze this long is noticeable on its own. */
  worstFrameMs: 500,
  offlineMs: 5_000,
} as const;

/** The value below which `fraction` of the samples fall. */
export function percentile(values: readonly number[], fraction: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(fraction * sorted.length) - 1),
  );
  return Math.round(sorted[index]!);
}

/** What made a report poor, in words; empty when it was fine. */
export function poorReasons(summary: {
  rttP95: number | null;
  saveP95: number | null;
  slowFrameMs: number;
  worstFrameMs: number;
  reconnects: number;
  rejected: number;
  offlineMs: number;
  errors: number;
}) {
  const reasons: string[] = [];
  if (summary.rttP95 !== null && summary.rttP95 > POOR.rttP95)
    reasons.push(`slow connection (${summary.rttP95} ms)`);
  if (summary.saveP95 !== null && summary.saveP95 > POOR.saveP95)
    reasons.push(`slow saves (${summary.saveP95} ms)`);
  if (summary.slowFrameMs > POOR.slowFrameMs)
    reasons.push(`screen froze ${summary.slowFrameMs} ms in total`);
  else if (summary.worstFrameMs > POOR.worstFrameMs)
    reasons.push(`a ${summary.worstFrameMs} ms freeze`);
  if (summary.reconnects)
    reasons.push(
      `${summary.reconnects} reconnect${summary.reconnects > 1 ? 's' : ''}`,
    );
  if (summary.offlineMs > POOR.offlineMs)
    reasons.push(`offline ${Math.round(summary.offlineMs / 1000)} s`);
  if (summary.rejected)
    reasons.push(
      `${summary.rejected} edit${summary.rejected > 1 ? 's' : ''} refused`,
    );
  if (summary.errors)
    reasons.push(
      `${summary.errors} script error${summary.errors > 1 ? 's' : ''}`,
    );
  return reasons;
}

export type BoardMetricRow = {
  id: string;
  appVersion: string | null;
  userId: string;
  guest: boolean;
  boardId: string;
  visibleMs: number;
  rttP50: number | null;
  rttP95: number | null;
  rttMax: number | null;
  saveP50: number | null;
  saveP95: number | null;
  saveMax: number | null;
  saves: number;
  reconnects: number;
  rejected: number;
  offlineMs: number;
  slowFrames: number;
  slowFrameMs: number;
  worstFrameMs: number;
  errors: number;
  firstError: string | null;
  objects: number;
  zoom: number;
  mobile: boolean;
  browser: string;
  os: string;
  cores: number | null;
  memoryGb: number | null;
  network: string | null;
  screen: string;
  country: string | null;
  poor: boolean;
  reasons: string[];
};

/** A report as it is stored: percentiles instead of every sample. */
export function summarise(
  report: BoardReport,
  who: { id: string; userId: string; guest: boolean; country?: string },
): BoardMetricRow {
  const summary = {
    rttP50: percentile(report.rtt, 0.5),
    rttP95: percentile(report.rtt, 0.95),
    rttMax: report.rtt.length ? Math.round(Math.max(...report.rtt)) : null,
    saveP50: percentile(report.saves, 0.5),
    saveP95: percentile(report.saves, 0.95),
    saveMax: report.saves.length ? Math.round(Math.max(...report.saves)) : null,
  };
  const reasons = poorReasons({
    rttP95: summary.rttP95,
    saveP95: summary.saveP95,
    slowFrameMs: Math.round(report.slowFrameMs),
    worstFrameMs: Math.round(report.worstFrameMs),
    reconnects: report.reconnects,
    rejected: report.rejected,
    offlineMs: Math.round(report.offlineMs),
    errors: report.errors,
  });
  return {
    id: who.id,
    appVersion: report.version ?? null,
    userId: who.userId,
    guest: who.guest,
    boardId: report.boardId,
    visibleMs: Math.round(report.visibleMs),
    ...summary,
    saves: report.saves.length,
    reconnects: report.reconnects,
    rejected: report.rejected,
    offlineMs: Math.round(report.offlineMs),
    slowFrames: report.slowFrames,
    slowFrameMs: Math.round(report.slowFrameMs),
    worstFrameMs: Math.round(report.worstFrameMs),
    errors: report.errors,
    firstError: report.firstError || null,
    objects: report.objects,
    zoom: report.zoom,
    mobile: report.device.mobile,
    browser: report.device.browser,
    os: report.device.os,
    cores: report.device.cores ?? null,
    memoryGb: report.device.memoryGb ?? null,
    network: report.device.network ?? null,
    screen: report.device.screen,
    country: who.country ?? null,
    poor: reasons.length > 0,
    reasons,
  };
}

/** Reports are kept this long. */
export const KEEP_METRICS_DAYS = 30;

/** Whose problem a poor minute was. */
export type Side = 'ours' | 'user' | 'unclear';

/** What classification needs from each poor minute. */
export type PoorMinute = {
  id: string;
  at: number;
  userId: string;
  rttP95: number | null;
  saveP95: number | null;
  reconnects: number;
  offlineMs: number;
  slowFrameMs: number;
  worstFrameMs: number;
  errors: number;
  rejected: number;
  objects: number;
  mobile: boolean;
  cores: number | null;
  memoryGb: number | null;
};

/** Minutes this close together count as "at the same time". */
const TOGETHER_MS = 3 * 60_000;
/** Connections from before an update are replaced within about 5 minutes. */
const AFTER_RELEASE_MS = 6 * 60_000;
/** Lone drops this many times within the window are a pattern. */
const REPEATS = 3;
const REPEAT_WINDOW_MS = 15 * 60_000;
/** A board this big is ours to make faster, whatever the device. */
const LARGE_BOARD = 1_500;
/** A connection this quick rules out the user's network. */
const GOOD_RTT = 400;

/**
 * Decides, for each poor minute, whether it was our side (our app, server or
 * an update we released), the user's side (their network or device), or
 * unclear, with the reasons in plain words.
 *
 * - Script errors and refused edits: ours.
 * - Slow saves: ours when their connection was quick, theirs when it wasn't.
 * - Slow connection or a dropped one: ours when several people had it at
 *   once, or it followed one of our updates; theirs when only they did
 *   (and for a drop, when their connection had also stalled); otherwise a
 *   lone short drop is unclear.
 * - Screen freezes: ours on large boards or normal devices; theirs on a
 *   phone or a low-powered computer.
 */
export function classifyPoor(minutes: PoorMinute[], releases: number[]) {
  const result = new Map<string, { side: Side; why: string[] }>();
  const connectionTrouble = (minute: PoorMinute) =>
    minute.reconnects > 0 ||
    minute.offlineMs > POOR.offlineMs ||
    (minute.rttP95 ?? 0) > POOR.rttP95;
  const othersAtOnce = (minute: PoorMinute) =>
    new Set(
      minutes
        .filter(
          (other) =>
            other.userId !== minute.userId &&
            Math.abs(other.at - minute.at) <= TOGETHER_MS &&
            connectionTrouble(other),
        )
        .map((other) => other.userId),
    ).size;
  // The same person dropping again and again on a steady connection is a
  // pattern, not bad luck: that is how last night's hidden-tab bug looked.
  const steadyDrop = (minute: PoorMinute) =>
    minute.reconnects > 0 && (minute.rttP95 ?? 0) <= POOR.rttP95;
  const repeatedDrops = (minute: PoorMinute) =>
    minutes.filter(
      (other) =>
        other.userId === minute.userId &&
        Math.abs(other.at - minute.at) <= REPEAT_WINDOW_MS &&
        steadyDrop(other),
    ).length;
  const afterRelease = (minute: PoorMinute) =>
    releases.some(
      (release) =>
        minute.at >= release - 60_000 &&
        minute.at - release <= AFTER_RELEASE_MS,
    );

  for (const minute of minutes) {
    const ours: string[] = [];
    const user: string[] = [];
    const unclear: string[] = [];
    const quick = minute.rttP95 !== null && minute.rttP95 <= GOOD_RTT;

    if (minute.errors) ours.push('A script error in our app');
    if (minute.rejected)
      ours.push('Our server refused or failed to save edits');

    if (minute.saveP95 !== null && minute.saveP95 > POOR.saveP95) {
      if (quick)
        ours.push(
          'Saves were slow while their connection was quick (our server or database)',
        );
      else user.push('Saves were slow because their connection was slow');
    }

    if (connectionTrouble(minute)) {
      const crowd = othersAtOnce(minute);
      if (crowd >= 1)
        ours.push(
          `${crowd + 1} people had connection trouble at the same time`,
        );
      else if (afterRelease(minute))
        ours.push('Right after we released an update (connections restart)');
      else if ((minute.rttP95 ?? 0) > POOR.rttP95)
        user.push('Only their connection was slow or stalled');
      else if (steadyDrop(minute) && repeatedDrops(minute) >= REPEATS)
        ours.push(
          `Dropped ${repeatedDrops(minute)} times in 30 minutes on a steady connection: likely our app`,
        );
      else
        unclear.push(
          'A single short drop with a normal connection: most likely their network',
        );
    }

    if (
      minute.slowFrameMs > POOR.slowFrameMs ||
      minute.worstFrameMs > POOR.worstFrameMs
    ) {
      const weak =
        minute.mobile ||
        (minute.cores !== null && minute.cores <= 4) ||
        (minute.memoryGb !== null && minute.memoryGb <= 4);
      if (minute.objects >= LARGE_BOARD)
        ours.push(
          `Screen froze on a large board (${minute.objects} items): our drawing code`,
        );
      else if (weak) user.push('Screen froze on a phone or low-powered device');
      else ours.push('Screen froze on a normal device: our app');
    }

    const side: Side = ours.length ? 'ours' : user.length ? 'user' : 'unclear';
    result.set(minute.id, {
      side,
      why: side === 'ours' ? ours : side === 'user' ? user : unclear,
    });
  }
  return result;
}
