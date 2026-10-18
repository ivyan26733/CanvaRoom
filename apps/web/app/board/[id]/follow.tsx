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
const MOVE_EVERY_MS = 150;
const MOVE_DURATION_MS = 260;
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

type Area = [number, number, number, number];

/**
 * The view that shows exactly the part of the canvas the writer sees: the
 * same centre, and the zoom that fits their whole area on this screen. On a
 * screen shaped like theirs, the zoom matches theirs.
 */
export function mirrorView(
  area: Area,
  size: { width: number; height: number },
): View {
  const [x, y, width, height] = area;
  const zoom = Math.min(
    MAX_ZOOM,
    Math.max(
      MIN_ZOOM,
      Math.min(
        size.width / Math.max(width, 1),
        size.height / Math.max(height, 1),
      ),
    ),
  );
  return {
    x: x + width / 2 - size.width / zoom / 2,
    y: y + height / 2 - size.height / zoom / 2,
    zoom,
  };
}

/**
 * For writers whose app does not share what they see: keep their pen on
 * screen at this person's own zoom, moving only when it nears the edge.
 */
export function followPoint(
  writing: Pick<Writing, 'x' | 'y'>,
  view: View,
  size: { width: number; height: number },
): View | null {
  const width = size.width / view.zoom;
  const height = size.height / view.zoom;
  const inset = 0.18;
  const inside =
    writing.x > view.x + width * inset &&
    writing.x < view.x + width * (1 - inset) &&
    writing.y > view.y + height * inset &&
    writing.y < view.y + height * (1 - inset);
  if (inside) return null;
  return {
    x: writing.x - width / 2,
    y: writing.y - height / 2,
    zoom: view.zoom,
  };
}

/** Whether two screens are shaped differently enough to outline the writer's area. */
const differentShape = (
  area: Area,
  size: { width: number; height: number },
) => {
  const theirs = area[2] / Math.max(area[3], 1);
  const ours = size.width / Math.max(size.height, 1);
  return Math.abs(theirs / ours - 1) > 0.04;
};

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
  const [frame, setFrame] = useState<Area | null>(null);
  const pausedUntil = useRef(0);
  const lastMove = useRef(0);
  // The writer's view last mirrored here. Writing alone never moves this
  // person's view; only the writer panning, zooming, or resizing does.
  const mirrored = useRef('');

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
      if (modeRef.current === 'paused' && now >= pausedUntil.current) {
        mirrored.current = '';
        setMode('following');
      }
      const showFrame =
        writer?.view &&
        modeRef.current === 'following' &&
        differentShape(writer.view, latest.current.size)
          ? writer.view
          : null;
      setFrame((current) =>
        current?.join() === showFrame?.join() ? current : showFrame,
      );
      if (!writer) mirrored.current = '';
      if (!writer || modeRef.current !== 'following') return;
      const { pageId, pages, size, moveView, goToPage, isBusy } =
        latest.current;
      // This person's own drawing always wins.
      if (isBusy() || now - lastLocalWrite.current < LOCAL_GRACE_MS) {
        mirrored.current = '';
        return;
      }
      if (now - lastMove.current < MOVE_EVERY_MS) {
        // Catch up once the throttle allows, even if nothing else changes.
        timer ??= setTimeout(
          evaluate,
          MOVE_EVERY_MS - (now - lastMove.current),
        );
        return;
      }
      const writerPage = pageOf(writer, pages);
      if (writerPage !== pageId) {
        lastMove.current = now;
        goToPage(writerPage);
        return;
      }
      if (writer.view) {
        const key = `${writer.peerId}:${writerPage}:${writer.view.join()}:${size.width}x${size.height}`;
        if (key === mirrored.current) return;
        mirrored.current = key;
        lastMove.current = now;
        moveView(mirrorView(writer.view, size), MOVE_DURATION_MS);
        return;
      }
      const target = followPoint(writer, viewRef.current, size);
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
    mirrored.current = '';
    saveMode('following');
    setMode('following');
  }, [setMode]);

  const stop = useCallback(() => {
    saveMode('off');
    setMode('off');
  }, [setMode]);

  return { mode, focus, frame, noteManualView, resume, stop };
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
