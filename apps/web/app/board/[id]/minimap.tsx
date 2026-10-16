'use client';

import { memo, useRef } from 'react';
import type { BoardObject } from '../../lib/api';
import { objectBounds, unionBounds, type Bounds } from '../../lib/canvas';

const WIDTH = 188;
const HEIGHT = 120;

type View = { x: number; y: number; zoom: number };

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

/** An overview of the page. Click or drag to move the camera. */
export function Minimap({
  objects,
  view,
  size,
  onMove,
}: {
  objects: BoardObject[];
  view: View;
  size: { width: number; height: number };
  onMove: (view: View) => void;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const viewport: Bounds = {
    x: view.x,
    y: view.y,
    width: size.width / view.zoom,
    height: size.height / view.zoom,
  };
  const content = unionBounds(objects);
  const area = content
    ? {
        x: Math.min(content.x, viewport.x),
        y: Math.min(content.y, viewport.y),
        right: Math.max(content.x + content.width, viewport.x + viewport.width),
        bottom: Math.max(
          content.y + content.height,
          viewport.y + viewport.height,
        ),
      }
    : {
        x: viewport.x,
        y: viewport.y,
        right: viewport.x + viewport.width,
        bottom: viewport.y + viewport.height,
      };
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
    onMove({
      x: wx - viewport.width / 2,
      y: wy - viewport.height / 2,
      zoom: view.zoom,
    });
  }

  return (
    <div className="minimap" aria-label="Minimap">
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
      </svg>
    </div>
  );
}
