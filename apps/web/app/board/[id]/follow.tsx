'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Page, Peer } from '../../lib/api';
import { pageOf } from '../../lib/canvas';
import { Icon } from '../../components/icons';
import {
  WRITING_GRACE_MS,
  type RemoteActivity,
  type Writing,
} from './live-layers';

type View = { x: number; y: number; zoom: number };
export type FollowMode = 'following' | 'paused' | 'off';

/** Panning or zooming by hand pauses following this long. */
const PAUSE_MS = 10_000;
/** The view stays put for this long after this person's own last stroke. */
const LOCAL_GRACE_MS = 2_500;
/** The writer may move this far towards the screen edge before the view follows. */
const COMFORT_INSET = 0.18;
const MOVE_EVERY_MS = 450;
const MOVE_DURATION_MS = 420;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;
const STORAGE_KEY = 'canvaroom.follow';

function readMode(): FollowMode {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'off' ? 'off' : 'following';
  } catch {
    return 'following';
  }
}

function saveMode(mode: FollowMode) {
  try {
    if (mode === 'off') localStorage.setItem(STORAGE_KEY, 'off');
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage can be unavailable; following still works for this visit.
  }
}

/**
 * Where to move so the writer's newest point is comfortably on screen, or
 * null when it already is. With `matchZoom`, when the writer sees a very
 * different amount of the canvas, the zoom changes to roughly match theirs.
 */
export function followTarget(
  writing: Pick<Writing, 'x' | 'y' | 'view'>,
  view: View,
  size: { width: number; height: number },
  matchZoom: boolean,
): View | null {
  const width = size.width / view.zoom;
  const height = size.height / view.zoom;
  let zoom = view.zoom;
  if (writing.view && matchZoom) {
    const [, , viewWidth, viewHeight] = writing.view;
    const fit = Math.min(
      size.width / Math.max(viewWidth, 1),
      size.height / Math.max(viewHeight, 1),
    );
    // Only large differences count, so small zoom changes never cause churn.
    if (fit / view.zoom > 2.5 || fit / view.zoom < 0.6)
      zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, fit));
  }
  const inside =
    writing.x > view.x + width * COMFORT_INSET &&
    writing.x < view.x + width * (1 - COMFORT_INSET) &&
    writing.y > view.y + height * COMFORT_INSET &&
    writing.y < view.y + height * (1 - COMFORT_INSET);
  if (inside && zoom === view.zoom) return null;
  return {
    x: writing.x - size.width / zoom / 2,
    y: writing.y - size.height / zoom / 2,
    zoom,
  };
}

/** Picks whose writing everyone's view follows: the earliest active writer keeps it. */
export function pickFocus(
  writers: readonly Writing[],
  current: string | null,
): Writing | null {
  return writers.find((item) => item.peerId === current) ?? writers[0] ?? null;
}

/**
 * Moves this person's view to whoever is writing, unless they are busy
 * themselves or have just moved the view by hand.
 */
export function useFollow({
  remote,
  enabled,
  pageId,
  pages,
  viewRef,
  size,
  moveView,
  goToPage,
  isBusy,
  lastLocalWrite,
}: {
  remote: RemoteActivity;
  enabled: boolean;
  pageId: string;
  pages: readonly Page[];
  viewRef: React.RefObject<View>;
  size: { width: number; height: number };
  moveView: (target: View, duration: number) => void;
  goToPage: (pageId: string) => void;
  isBusy: () => boolean;
  lastLocalWrite: React.RefObject<number>;
}) {
  const [mode, setModeState] = useState<FollowMode>('following');
  const [focus, setFocus] = useState<Writing | null>(null);
  const modeRef = useRef<FollowMode>('following');
  const focusRef = useRef<string | null>(null);
  const pausedUntil = useRef(0);
  const lastMove = useRef(0);
  // Zoom is matched once per burst of writing, so a zoom chosen by hand
  // afterwards sticks while the view keeps panning along.
  const zoomedFor = useRef('');

  const setMode = useCallback((next: FollowMode) => {
    modeRef.current = next;
    setModeState(next);
  }, []);

  useEffect(() => {
    const saved = readMode();
    if (saved === 'off') setMode('off');
  }, [setMode]);

  // Values the evaluation reads without re-subscribing.
  const latest = useRef({ pageId, pages, size, moveView, goToPage, isBusy });
  useEffect(() => {
    latest.current = { pageId, pages, size, moveView, goToPage, isBusy };
  });

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const evaluate = () => {
      timer = undefined;
      const now = Date.now();
      const writer = pickFocus(remote.activeWriters(now), focusRef.current);
      if ((writer?.peerId ?? null) !== focusRef.current) {
        focusRef.current = writer?.peerId ?? null;
      }
      setFocus((current) =>
        current?.peerId === writer?.peerId && current?.page === writer?.page
          ? current
          : writer,
      );
      if (modeRef.current === 'paused' && now >= pausedUntil.current)
        setMode('following');
      if (!writer || modeRef.current !== 'following') return;
      const { pageId, pages, size, moveView, goToPage, isBusy } =
        latest.current;
      // This person's own drawing always wins.
      if (isBusy() || now - lastLocalWrite.current < LOCAL_GRACE_MS) return;
      if (now - lastMove.current < MOVE_EVERY_MS) return;
      const writerPage = pageOf(writer, pages);
      if (writerPage !== pageId) {
        lastMove.current = now;
        goToPage(writerPage);
        return;
      }
      const burst = `${writer.peerId}:${writer.since}`;
      const target = followTarget(
        writer,
        viewRef.current,
        size,
        zoomedFor.current !== burst,
      );
      zoomedFor.current = burst;
      if (!target) return;
      lastMove.current = now;
      moveView(target, MOVE_DURATION_MS);
    };
    const schedule = () => {
      timer ??= setTimeout(evaluate, 120);
    };
    const unsubscribe = remote.subscribe(schedule);
    // Notices the end of the grace period when nothing else changes.
    const tick = setInterval(schedule, WRITING_GRACE_MS / 2);
    return () => {
      unsubscribe();
      clearInterval(tick);
      clearTimeout(timer);
    };
  }, [enabled, remote, viewRef, lastLocalWrite, setMode]);

  /** Called when this person pans, zooms, or changes page by hand. */
  const noteManualView = useCallback(() => {
    if (modeRef.current === 'off') return;
    pausedUntil.current = Date.now() + PAUSE_MS;
    if (modeRef.current !== 'paused') setMode('paused');
  }, [setMode]);

  const resume = useCallback(() => {
    pausedUntil.current = 0;
    lastMove.current = 0;
    saveMode('following');
    setMode('following');
  }, [setMode]);

  const stop = useCallback(() => {
    saveMode('off');
    setMode('off');
  }, [setMode]);

  return { mode, focus, noteManualView, resume, stop };
}

/** Says whose writing is being followed, with a way to stop or resume. */
export function FollowChip({
  focus,
  mode,
  peers,
  pages,
  pageId,
  onResume,
  onStop,
  onGo,
}: {
  focus: Writing | null;
  mode: FollowMode;
  peers: readonly Peer[];
  pages: readonly Page[];
  pageId: string;
  onResume: () => void;
  onStop: () => void;
  onGo: (pageId: string) => void;
}) {
  if (!focus) return null;
  const peer = peers.find((item) => item.peerId === focus.peerId);
  if (!peer) return null;
  const writerPage = pageOf(focus, pages);
  const elsewhere =
    writerPage !== pageId
      ? pages.find((page) => page.id === writerPage)
      : undefined;
  return (
    <div
      className={`follow-chip is-${mode}`}
      role="status"
      style={{ '--peer': peer.color } as React.CSSProperties}
    >
      <span className="follow-dot" aria-hidden="true" />
      {mode === 'following' ? (
        <>
          <span>
            Following <strong>{peer.name}</strong>
            {elsewhere ? ` to ${elsewhere.name}` : ''}
          </span>
          <button
            className="follow-action"
            onClick={onStop}
            title="Stop following whoever is writing"
          >
            <Icon name="close" size={13} />
            <span>Stop</span>
          </button>
        </>
      ) : (
        <>
          <span>
            <strong>{peer.name}</strong> is writing
            {elsewhere ? ` on ${elsewhere.name}` : ''}
            {mode === 'paused' ? ' · paused' : ''}
          </span>
          {elsewhere && (
            <button className="follow-action" onClick={() => onGo(writerPage)}>
              Go
            </button>
          )}
          <button className="follow-action primary" onClick={onResume}>
            Follow
          </button>
        </>
      )}
    </div>
  );
}
