'use client';

import { memo, useMemo, useRef, useSyncExternalStore } from 'react';
import type { BoardObject, Page, Peer } from '../../lib/api';
import {
  objectBounds,
  pageOf,
  unionBounds,
  type Bounds,
} from '../../lib/canvas';
import type { RemoteActivity } from './live-layers';

const WIDTH = 188;
const HEIGHT = 120;

type View = { x: number; y: number; zoom: number };

const noActivity = () => () => undefined;

/** Who is writing where, rounded, so cursor movement alone never redraws. */
function writersKey(activity: RemoteActivity | null) {
  if (!activity) return '';
  return activity
    .activeWriters(activity.renderedAt)
    .map(
      (item) =>
        `${item.peerId}:${item.page ?? ''}:${Math.round(item.x / 8)}:${Math.round(item.y / 8)}`,
    )
    .join('|');
}

/** Object outlines, redrawn only when the objects change. */
const MinimapContent = memo(function MinimapContent({
  objects,
}: {
  objects: BoardObject[];
}) {
  return (
    <g>
      {objects.map((object) => {
        const box = objectBounds(object);
        return (
          <rect
            key={object.id}
            x={box.x}
            y={box.y}
            width={Math.max(box.width, 1)}
            height={Math.max(box.height, 1)}
            fill={
              object.kind === 'sticky'
                ? object.color.slice(0, 7)
                : 'currentColor'
            }
            opacity={object.kind === 'sticky' ? 0.9 : 0.35}
          />
        );
      })}
    </g>
  );
});

/**
 * An overview of the page that doubles as a locator: everyone writing right
 * now shows as a pulsing dot. Click or drag to move the camera, or click a
 * dot or name to jump to that writer. It appears on its own while someone
 * writes, even when the minimap is switched off.
 */
export function Minimap({
  open,
  objects,
  view,
  size,
  activity,
  peers,
  page,
  pages,
  onMove,
  onGoToPage,
}: {
  open: boolean;
  objects: BoardObject[];
  view: View;
  size: { width: number; height: number };
  activity: RemoteActivity | null;
  peers: readonly Peer[];
  page: string;
  pages: readonly Page[];
  onMove: (view: View, animate: boolean) => void;
  onGoToPage: (pageId: string) => void;
}) {
  const ref = useRef<SVGSVGElement>(null);
  useSyncExternalStore(
    activity?.subscribe ?? noActivity,
    () => writersKey(activity),
    () => '',
  );
  const content = useMemo(() => unionBounds(objects), [objects]);
  const names = new Map(peers.map((peer) => [peer.peerId, peer]));
  const writers = (activity?.activeWriters(activity.renderedAt) ?? []).flatMap(
    (writing) => {
      const peer = names.get(writing.peerId);
      return peer ? [{ ...writing, peer, page: pageOf(writing, pages) }] : [];
    },
  );
  if (!open && !writers.length) return null;
  const here = writers.filter((item) => item.page === page);

  const viewport: Bounds = {
    x: view.x,
    y: view.y,
    width: size.width / view.zoom,
    height: size.height / view.zoom,
  };
  const area = {
    x: Math.min(content?.x ?? viewport.x, viewport.x),
    y: Math.min(content?.y ?? viewport.y, viewport.y),
    right: Math.max(
      content ? content.x + content.width : -Infinity,
      viewport.x + viewport.width,
    ),
    bottom: Math.max(
      content ? content.y + content.height : -Infinity,
      viewport.y + viewport.height,
    ),
  };
  // Writers are always on the map, however far they are from everything else.
  for (const item of here) {
    area.x = Math.min(area.x, item.x);
    area.y = Math.min(area.y, item.y);
    area.right = Math.max(area.right, item.x);
    area.bottom = Math.max(area.bottom, item.y);
  }
  const pad = Math.max(area.right - area.x, area.bottom - area.y) * 0.06;
  const world = {
    x: area.x - pad,
    y: area.y - pad,
    width: area.right - area.x + pad * 2,
    height: area.bottom - area.y + pad * 2,
  };
  // Match the minimap's aspect ratio so clicks map to the right place.
  const fit = Math.max(world.width / WIDTH, world.height / HEIGHT);
  const box = {
    x: world.x + world.width / 2 - (WIDTH * fit) / 2,
    y: world.y + world.height / 2 - (HEIGHT * fit) / 2,
    width: WIDTH * fit,
    height: HEIGHT * fit,
  };

  function centreOn(event: React.PointerEvent<SVGSVGElement>) {
    const rect = ref.current!.getBoundingClientRect();
    const wx = box.x + ((event.clientX - rect.left) / rect.width) * box.width;
    const wy = box.y + ((event.clientY - rect.top) / rect.height) * box.height;
    onMove(
      {
        x: wx - viewport.width / 2,
        y: wy - viewport.height / 2,
        zoom: view.zoom,
      },
      false,
    );
  }

  function jumpTo(writer: (typeof writers)[number]) {
    if (writer.page !== page) {
      onGoToPage(writer.page);
      return;
    }
    onMove(
      {
        x: writer.x - viewport.width / 2,
        y: writer.y - viewport.height / 2,
        zoom: view.zoom,
      },
      true,
    );
  }

  return (
    <div
      className={`minimap ${writers.length ? 'has-writers' : ''}`}
      aria-label="Minimap"
    >
      <svg
        ref={ref}
        width={WIDTH}
        height={HEIGHT}
        viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          centreOn(event);
        }}
        onPointerMove={(event) => {
          if (event.buttons) centreOn(event);
        }}
      >
        <MinimapContent objects={objects} />
        <rect
          className="minimap-viewport"
          x={viewport.x}
          y={viewport.y}
          width={viewport.width}
          height={viewport.height}
          strokeWidth={fit * 1.5}
          rx={fit * 3}
        />
        {here.map((writer) => (
          <g
            key={writer.peerId}
            className="minimap-writer"
            transform={`translate(${writer.x} ${writer.y}) scale(${fit})`}
            style={{ color: writer.peer.color }}
            onPointerDown={(event) => {
              event.stopPropagation();
              jumpTo(writer);
            }}
          >
            <title>{`${writer.peer.name} is writing here`}</title>
            <circle className="minimap-writer-pulse" r="9" />
            <circle
              r="4.5"
              fill="currentColor"
              stroke="#fff"
              strokeWidth="1.5"
            />
          </g>
        ))}
      </svg>
      {writers.length > 0 && (
        <ul className="minimap-writers" aria-label="Writing now">
          {writers.map((writer) => (
            <li key={writer.peerId}>
              <button
                onClick={() => jumpTo(writer)}
                title={
                  writer.page === page
                    ? `Go to where ${writer.peer.name} is writing`
                    : `Go to the page ${writer.peer.name} is on`
                }
              >
                <span
                  className="minimap-writer-dot"
                  style={{ background: writer.peer.color }}
                />
                <span className="minimap-writer-name">{writer.peer.name}</span>
                {writer.page !== page && (
                  <span className="minimap-writer-page">
                    {pages.find((item) => item.id === writer.page)?.name}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
