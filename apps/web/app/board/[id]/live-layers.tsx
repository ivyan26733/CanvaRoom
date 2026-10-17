import {
  forwardRef,
  memo,
  useImperativeHandle,
  useState,
  useSyncExternalStore,
} from 'react';
import type { BoardObject, Page, Peer } from '../../lib/api';
import { pageOf, type Bounds } from '../../lib/canvas';
import type { LiveMessage } from '../../lib/realtime';
import { BoardShape } from './board-shape';

const DRAFT_TIMEOUT_MS = 15_000;
/** How long after their last stroke someone still counts as writing. */
export const WRITING_GRACE_MS = 2_500;

/** Where someone is writing right now. */
export type Writing = {
  peerId: string;
  /** When this burst of writing began; the earliest writer keeps the focus. */
  since: number;
  at: number;
  page?: string;
  /** The newest point of their pen, shape, or text, in canvas units. */
  x: number;
  y: number;
  /** What they can see while writing: x, y, width, height. */
  view?: [number, number, number, number];
};

/**
 * What other people are doing right now — their cursors and anything they
 * are drawing, moving, or typing that has not been committed yet.
 *
 * Kept outside React state so that a burst of live messages re-renders only
 * the remote layer, at most once per animation frame.
 */
export class RemoteActivity {
  drafts = new Map<
    string,
    { peerId: string; object: BoardObject; at: number }
  >();
  cursors = new Map<
    string,
    { x: number; y: number; page?: string; at: number }
  >();
  /** People drawing, erasing, or typing, by peer. */
  writing = new Map<string, Writing>();
  private version = 0;
  /** When the layer last changed, for fading idle cursors without impure renders. */
  renderedAt = 0;
  private listeners = new Set<() => void>();
  private frame: number | undefined;
  private sweep = setInterval(() => this.expire(), 5_000);
  /** Redraws once writing goes quiet, so locator dots disappear on time. */
  private quiet: ReturnType<typeof setTimeout> | undefined;

  apply(message: LiveMessage) {
    const now = Date.now();
    const { peerId } = message;
    // Writers send an active cursor at their pen tip (or text) every frame.
    const tip = message.cursor?.active ? message.cursor : undefined;
    if (message.cursor) {
      const { x, y, page } = message.cursor;
      this.cursors.set(peerId, { x, y, ...(page ? { page } : {}), at: now });
    } else if (message.cursor === null) this.cursors.delete(peerId);
    for (const object of message.upsert ?? [])
      this.drafts.set(object.id, { peerId, object, at: now });
    for (const { id, points } of message.append ?? []) {
      const draft = this.drafts.get(id);
      if (!draft) continue;
      draft.object = {
        ...draft.object,
        points: [...(draft.object.points ?? []), ...points],
      };
      draft.at = now;
    }
    for (const id of message.remove ?? []) this.drafts.delete(id);
    if (tip) {
      const previous = this.writing.get(peerId);
      const view = tip.view ?? previous?.view;
      this.writing.set(peerId, {
        peerId,
        since:
          previous && now - previous.at < WRITING_GRACE_MS
            ? previous.since
            : now,
        at: now,
        x: tip.x,
        y: tip.y,
        ...(tip.page ? { page: tip.page } : {}),
        ...(view ? { view } : {}),
      });
      clearTimeout(this.quiet);
      this.quiet = setTimeout(() => this.changed(), WRITING_GRACE_MS + 50);
    }
    this.changed();
  }

  /** People who wrote within the grace period, earliest first. */
  activeWriters(now = Date.now()) {
    return [...this.writing.values()]
      .filter((item) => now - item.at < WRITING_GRACE_MS)
      .sort((a, b) => a.since - b.since);
  }

  /** A committed operation supersedes any live draft of the same object. */
  settle(objectId: string) {
    if (this.drafts.delete(objectId)) this.changed();
  }

  dropPeer(peerId: string) {
    this.cursors.delete(peerId);
    this.writing.delete(peerId);
    for (const [id, draft] of this.drafts)
      if (draft.peerId === peerId) this.drafts.delete(id);
    this.changed();
  }

  /** Drops drafts of the given objects, which are committed now. */
  forget(ids: Iterable<string>) {
    let changed = false;
    for (const id of ids) changed = this.drafts.delete(id) || changed;
    if (changed) this.changed();
  }

  clear() {
    this.drafts.clear();
    this.cursors.clear();
    this.writing.clear();
    this.changed();
  }

  private expire() {
    const cutoff = Date.now() - DRAFT_TIMEOUT_MS;
    let changed = false;
    for (const [id, draft] of this.drafts)
      if (draft.at < cutoff) changed = this.drafts.delete(id) || changed;
    for (const [peerId, item] of this.writing)
      if (item.at < cutoff) this.writing.delete(peerId);
    if (changed) this.changed();
  }

  private changed() {
    if (this.frame !== undefined) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = undefined;
      this.version++;
      this.renderedAt = Date.now();
      for (const listener of this.listeners) listener();
    });
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = () => this.version;

  dispose() {
    clearInterval(this.sweep);
    clearTimeout(this.quiet);
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.listeners.clear();
  }
}

/** Hides committed objects while someone is dragging a live copy of them. */
function hideRule(ids: Iterable<string>) {
  const selectors = [...ids].map((id) => `[data-oid="${CSS.escape(id)}"]`);
  return selectors.length ? `${selectors.join(',')}{visibility:hidden}` : '';
}

/** Which page each remote cursor is on, for the pages panel. */
export function usePeersByPage(
  activity: RemoteActivity,
  peers: Peer[],
  pages: readonly Page[],
) {
  useSyncExternalStore(activity.subscribe, activity.getVersion, () => 0);
  const byPage = new Map<string, Peer[]>();
  for (const peer of peers) {
    const cursor = activity.cursors.get(peer.peerId);
    if (!cursor) continue;
    const page = pageOf(cursor, pages);
    byPage.set(page, [...(byPage.get(page) ?? []), peer]);
  }
  return byPage;
}

export const RemoteLayer = memo(function RemoteLayer({
  activity,
  peers,
  zoom,
  page,
  pages,
}: {
  activity: RemoteActivity;
  peers: Peer[];
  zoom: number;
  page: string;
  pages: readonly Page[];
}) {
  useSyncExternalStore(activity.subscribe, activity.getVersion, () => 0);
  const names = new Map(peers.map((peer) => [peer.peerId, peer]));
  const scale = 1 / zoom;
  const now = activity.renderedAt;
  return (
    <g className="remote-layer">
      <style>{hideRule(activity.drafts.keys())}</style>
      <g className="remote-drafts">
        {[...activity.drafts.values()].map(({ object }) =>
          pageOf(object, pages) === page ? (
            <BoardShape key={object.id} item={object} ghost />
          ) : null,
        )}
      </g>
      {[...activity.cursors].map(([peerId, cursor]) => {
        const peer = names.get(peerId);
        if (!peer) return null;
        if (pageOf(cursor, pages) !== page) return null;
        return (
          <g
            key={peerId}
            className="remote-cursor"
            style={{
              transform: `translate(${cursor.x}px, ${cursor.y}px) scale(${scale})`,
              opacity: now - cursor.at > 12_000 ? 0.35 : 1,
            }}
            pointerEvents="none"
          >
            <path
              d="M0 0L0 17L4.6 12.9L8 20.6L11.3 19.2L7.9 11.7L14 11.7Z"
              fill={peer.color}
              stroke="#fff"
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
            <g transform="translate(14 18)">
              <rect
                width={Math.max(28, peer.name.length * 7.2 + 14)}
                height="20"
                rx="10"
                fill={peer.color}
              />
              <text x="7" y="14" fill="#fff" fontSize="11.5" fontWeight="600">
                {peer.name}
              </text>
            </g>
          </g>
        );
      })}
    </g>
  );
});

export type LocalOverlayState = {
  /** Objects being drawn, moved, or resized by this tab. */
  objects?: BoardObject[];
  /** Committed objects to hide while `objects` stands in for them. */
  hide?: string[];
  marquee?: Bounds | null;
};

export type LocalOverlayHandle = { set: (state: LocalOverlayState) => void };

/**
 * This tab's in-progress gesture. Updated imperatively on every pointer move
 * so drawing never re-renders the rest of the board.
 */
export const LocalOverlay = forwardRef<LocalOverlayHandle, { zoom: number }>(
  function LocalOverlay({ zoom }, ref) {
    const [state, setState] = useState<LocalOverlayState>({});
    useImperativeHandle(ref, () => ({ set: setState }), []);
    const scale = 1 / zoom;
    return (
      <g className="local-overlay">
        {state.hide?.length ? <style>{hideRule(state.hide)}</style> : null}
        {state.objects?.map((object) => (
          <BoardShape
            key={object.id}
            item={object}
            ghost
            selected={Boolean(state.hide?.includes(object.id))}
            scale={scale}
          />
        ))}
        {state.marquee && (
          <rect
            x={state.marquee.x}
            y={state.marquee.y}
            width={state.marquee.width}
            height={state.marquee.height}
            fill="#2d5bff14"
            stroke="#2d5bff"
            strokeWidth={scale}
            strokeDasharray={`${4 * scale} ${3 * scale}`}
            pointerEvents="none"
          />
        )}
      </g>
    );
  },
);
