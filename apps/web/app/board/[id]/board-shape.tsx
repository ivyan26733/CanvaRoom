import { memo } from 'react';
import type { BoardObject } from '../../lib/api';
import {
  arrowHead,
  arrowShaft,
  defaultFontSize,
  FONT_FAMILY,
  layoutText,
  LINE_HEIGHT,
  objectBounds,
  smoothPath,
  STICKY_PADDING,
  tint,
} from '../../lib/canvas';

export const RESIZABLE = new Set<BoardObject['kind']>([
  'rect',
  'ellipse',
  'diamond',
  'image',
  'sticky',
]);
const SELECTION = '#2d5bff';

function textLines(lines: string[], fontSize: number, x: number) {
  const lineHeight = fontSize * LINE_HEIGHT;
  // Matches the textarea editor: glyphs sit centred in each line box.
  const baseline = fontSize * ((LINE_HEIGHT - 1) / 2 + 0.8);
  return lines.map((line, index) => (
    <tspan key={index} x={x} y={baseline + index * lineHeight}>
      {line || ' '}
    </tspan>
  ));
}

function Shape({ item }: { item: BoardObject }) {
  const stroke = item.color;
  const width = Math.max(1, item.width ?? 1);
  const height = Math.max(1, item.height ?? 1);
  const fill = item.fillColor ?? tint(stroke, '1f');
  switch (item.kind) {
    case 'path': {
      const d = smoothPath(item.points ?? []);
      return (
        <>
          <path
            d={d}
            fill="none"
            stroke="transparent"
            strokeWidth={Math.max(14, item.strokeWidth + 10)}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d={d}
            fill="none"
            stroke={stroke}
            strokeWidth={item.strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      );
    }
    case 'line':
    case 'arrow': {
      const points = item.points ?? [0, 0, width, height];
      const d =
        item.kind === 'arrow'
          ? arrowShaft(points, item.strokeWidth)
          : `M${points[0]} ${points[1]}L${points[2]} ${points[3]}`;
      return (
        <>
          <path
            d={`M${points[0]} ${points[1]}L${points[2]} ${points[3]}`}
            stroke="transparent"
            strokeWidth={Math.max(14, item.strokeWidth + 10)}
          />
          <path
            d={d}
            fill="none"
            stroke={stroke}
            strokeWidth={item.strokeWidth}
            strokeLinecap="round"
          />
          {item.kind === 'arrow' && (
            <polygon
              points={arrowHead(points, item.strokeWidth)}
              fill={stroke}
              stroke={stroke}
              strokeWidth={Math.min(2, item.strokeWidth)}
              strokeLinejoin="round"
            />
          )}
        </>
      );
    }
    case 'rect':
      return (
        <rect
          width={width}
          height={height}
          rx={Math.min(10, width / 4, height / 4)}
          fill={fill}
          stroke={stroke}
          strokeWidth={item.strokeWidth}
        />
      );
    case 'ellipse':
      return (
        <ellipse
          cx={width / 2}
          cy={height / 2}
          rx={width / 2}
          ry={height / 2}
          fill={fill}
          stroke={stroke}
          strokeWidth={item.strokeWidth}
        />
      );
    case 'diamond':
      return (
        <polygon
          points={`${width / 2},0 ${width},${height / 2} ${width / 2},${height} 0,${height / 2}`}
          fill={fill}
          stroke={stroke}
          strokeWidth={item.strokeWidth}
          strokeLinejoin="round"
        />
      );
    case 'sticky': {
      const fontSize = defaultFontSize(item);
      const layout = layoutText(
        item.text ?? '',
        fontSize,
        width - STICKY_PADDING * 2,
      );
      const visible = Math.max(
        1,
        Math.floor((height - STICKY_PADDING * 2) / (fontSize * LINE_HEIGHT)),
      );
      return (
        <>
          <rect y="3" width={width} height={height} rx="6" fill="#1b1b1b14" />
          <rect width={width} height={height} rx="6" fill="#fffdf6" />
          <rect
            width={width}
            height={height}
            rx="6"
            fill={item.fillColor ?? tint(stroke, '59')}
            stroke={tint(stroke, '80')}
          />
          <text
            fill="#22201c"
            fontSize={fontSize}
            fontFamily={FONT_FAMILY}
            transform={`translate(0 ${STICKY_PADDING})`}
          >
            {textLines(
              layout.lines.slice(0, visible),
              fontSize,
              STICKY_PADDING,
            )}
          </text>
        </>
      );
    }
    case 'image':
      return (
        <image
          href={item.src}
          width={width}
          height={height}
          preserveAspectRatio="xMidYMid meet"
        />
      );
    case 'text': {
      const fontSize = defaultFontSize(item);
      return (
        <text fill={stroke} fontSize={fontSize} fontFamily={FONT_FAMILY}>
          {textLines(layoutText(item.text ?? '', fontSize).lines, fontSize, 0)}
        </text>
      );
    }
  }
}

/**
 * One canvas object. Pointer handling is delegated to the stage through
 * `data-oid`, so this component only re-renders when its own object changes.
 */
export const BoardShape = memo(function BoardShape({
  item,
  selected = false,
  scale = 1,
  ghost = false,
  showHandle = false,
}: {
  item: BoardObject;
  selected?: boolean;
  /** 1 / zoom, so selection chrome keeps a constant on-screen size. */
  scale?: number;
  /** Rendered for someone else's in-progress work: not selectable. */
  ghost?: boolean;
  showHandle?: boolean;
}) {
  const bounds = selected ? objectBounds(item) : null;
  return (
    <g
      transform={`translate(${item.x} ${item.y})${item.rotation ? ` rotate(${item.rotation})` : ''}`}
      opacity={item.opacity ?? 1}
      {...(ghost
        ? { pointerEvents: 'none' }
        : { 'data-oid': item.id, className: 'canvas-object' })}
    >
      <Shape item={item} />
      {bounds && (
        <g data-ui="selection">
          <rect
            x={bounds.x - item.x - 5 * scale}
            y={bounds.y - item.y - 5 * scale}
            width={bounds.width + 10 * scale}
            height={bounds.height + 10 * scale}
            fill="none"
            stroke={SELECTION}
            strokeWidth={1.5 * scale}
            strokeDasharray={`${5 * scale} ${4 * scale}`}
            pointerEvents="none"
          />
          {showHandle && RESIZABLE.has(item.kind) && (
            <circle
              data-handle="resize"
              cx={bounds.x - item.x + bounds.width + 5 * scale}
              cy={bounds.y - item.y + bounds.height + 5 * scale}
              r={7 * scale}
              fill="#fff"
              stroke={SELECTION}
              strokeWidth={2 * scale}
              className="resize-handle"
            />
          )}
        </g>
      )}
    </g>
  );
});
