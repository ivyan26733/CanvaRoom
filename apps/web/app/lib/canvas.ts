import type { BoardObject } from './api';

export type Point = { x: number; y: number };
export type Bounds = { x: number; y: number; width: number; height: number };

export const FONT_FAMILY = 'Inter, ui-sans-serif, system-ui, Arial, sans-serif';
export const STICKY_PADDING = 16;
export const LINE_HEIGHT = 1.3;

/**
 * Turns a flat [x0, y0, x1, y1, …] list into a smooth SVG path by curving
 * through the midpoints between samples, which hides pointer jitter.
 */
export function smoothPath(points: readonly number[]) {
  const count = Math.floor(points.length / 2);
  if (count === 0) return '';
  const x = (index: number) => points[index * 2]!;
  const y = (index: number) => points[index * 2 + 1]!;
  if (count === 1) return `M${x(0)} ${y(0)}l0.01 0`;
  if (count === 2) return `M${x(0)} ${y(0)}L${x(1)} ${y(1)}`;
  let d = `M${x(0)} ${y(0)}`;
  for (let index = 1; index < count - 1; index++) {
    const midX = (x(index) + x(index + 1)) / 2;
    const midY = (y(index) + y(index + 1)) / 2;
    d += `Q${x(index)} ${y(index)} ${round(midX)} ${round(midY)}`;
  }
  return `${d}L${x(count - 1)} ${y(count - 1)}`;
}

export function round(value: number) {
  return Math.round(value * 10) / 10;
}

let measureContext: CanvasRenderingContext2D | null | undefined;
function measure(text: string, fontSize: number) {
  if (measureContext === undefined)
    measureContext =
      typeof document === 'undefined'
        ? null
        : document.createElement('canvas').getContext('2d');
  if (!measureContext) return text.length * fontSize * 0.56;
  measureContext.font = `${fontSize}px ${FONT_FAMILY}`;
  return measureContext.measureText(text).width;
}

/** Splits text into lines, wrapping words to `maxWidth` when given. */
export function layoutText(text: string, fontSize: number, maxWidth?: number) {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    if (!maxWidth) {
      lines.push(paragraph);
      continue;
    }
    let line = '';
    for (const word of paragraph.split(/(\s+)/)) {
      const next = line + word;
      if (line && measure(next.trimEnd(), fontSize) > maxWidth) {
        lines.push(line.trimEnd());
        line = word.trimStart();
      } else line = next;
    }
    lines.push(line);
  }
  const width = Math.max(0, ...lines.map((line) => measure(line, fontSize)));
  return {
    lines,
    width,
    height: Math.max(1, lines.length) * fontSize * LINE_HEIGHT,
  };
}

export function defaultFontSize(object: BoardObject) {
  return object.fontSize ?? (object.kind === 'sticky' ? 18 : 28);
}

/** World-space bounding box of an object, used for selection and hit tests. */
export function objectBounds(object: BoardObject): Bounds {
  if (object.kind === 'text') {
    const layout = layoutText(object.text || ' ', defaultFontSize(object));
    return {
      x: object.x,
      y: object.y,
      width: Math.max(20, layout.width),
      height: layout.height,
    };
  }
  const points = object.points ?? [];
  if (points.length >= 2) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let index = 0; index < points.length - 1; index += 2) {
      minX = Math.min(minX, points[index]!);
      maxX = Math.max(maxX, points[index]!);
      minY = Math.min(minY, points[index + 1]!);
      maxY = Math.max(maxY, points[index + 1]!);
    }
    const pad = object.strokeWidth / 2;
    return {
      x: object.x + minX - pad,
      y: object.y + minY - pad,
      width: maxX - minX + pad * 2,
      height: maxY - minY + pad * 2,
    };
  }
  return {
    x: object.x,
    y: object.y,
    width: object.width ?? 1,
    height: object.height ?? 1,
  };
}

export function unionBounds(objects: readonly BoardObject[]): Bounds | null {
  if (!objects.length) return null;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const object of objects) {
    const bounds = objectBounds(object);
    left = Math.min(left, bounds.x);
    top = Math.min(top, bounds.y);
    right = Math.max(right, bounds.x + bounds.width);
    bottom = Math.max(bottom, bounds.y + bounds.height);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function intersects(a: Bounds, b: Bounds) {
  return (
    a.x <= b.x + b.width &&
    b.x <= a.x + a.width &&
    a.y <= b.y + b.height &&
    b.y <= a.y + a.height
  );
}

/** A filled triangle for the end of an arrow, sized to its stroke. */
export function arrowHead(points: readonly number[], strokeWidth: number) {
  const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = points;
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const length = 10 + strokeWidth * 2.4;
  const spread = Math.PI / 7;
  const left = {
    x: x2 - length * Math.cos(angle - spread),
    y: y2 - length * Math.sin(angle - spread),
  };
  const right = {
    x: x2 - length * Math.cos(angle + spread),
    y: y2 - length * Math.sin(angle + spread),
  };
  return `${x2},${y2} ${round(left.x)},${round(left.y)} ${round(right.x)},${round(right.y)}`;
}

/** The arrow shaft stops short of the tip so a thick stroke stays pointed. */
export function arrowShaft(points: readonly number[], strokeWidth: number) {
  const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = points;
  const length = Math.hypot(x2 - x1, y2 - y1) || 1;
  const inset = Math.min(length, (10 + strokeWidth * 2.4) * 0.6);
  return `M${x1} ${y1}L${round(x2 - ((x2 - x1) / length) * inset)} ${round(y2 - ((y2 - y1) / length) * inset)}`;
}

/** Translucent fill derived from a stroke colour, e.g. #458a72 → #458a7224. */
export function tint(color: string, alpha: string) {
  return `${color.slice(0, 7)}${alpha}`;
}

/** Applies create/update/delete operations to a list of objects. */
export function applyOperations(
  objects: readonly BoardObject[],
  operations: readonly {
    type: 'create' | 'update' | 'delete';
    objectId: string;
    object?: BoardObject;
    fields?: Partial<BoardObject>;
  }[],
) {
  let next = objects as BoardObject[];
  for (const op of operations) {
    if (op.type === 'create' && op.object) {
      if (next.some((item) => item.id === op.objectId)) continue;
      next = [...next, op.object];
    } else if (op.type === 'delete') {
      next = next.filter((item) => item.id !== op.objectId);
    } else if (op.fields) {
      next = next.map((item) =>
        item.id === op.objectId ? { ...item, ...op.fields } : item,
      );
    }
  }
  return next;
}
