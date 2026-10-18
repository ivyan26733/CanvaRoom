import type { BoardObject, Page } from './api';

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

/**
 * Closed shapes drawn to fill their box. They all take a fill colour, resize
 * from their corner, and keep their proportions with Shift.
 */
export const BOX_SHAPES = [
  'rect',
  'ellipse',
  'diamond',
  'triangle',
  'right-triangle',
  'parallelogram',
  'trapezoid',
  'pentagon',
  'hexagon',
  'star',
  'cylinder',
  'bubble',
] as const;
export type BoxShape = (typeof BOX_SHAPES)[number];
export const isBoxShape = (kind: string): kind is BoxShape =>
  (BOX_SHAPES as readonly string[]).includes(kind);

const polygon = (points: [number, number][]) =>
  `M${points.map(([x, y]) => `${round(x)} ${round(y)}`).join('L')}Z`;

/** A regular polygon (or a star, with an inner radius) stretched to the box. */
function radial(
  corners: number,
  width: number,
  height: number,
  inner?: number,
  start = -Math.PI / 2,
) {
  const steps = inner ? corners * 2 : corners;
  const raw: [number, number][] = [];
  for (let index = 0; index < steps; index++) {
    const angle = start + (index * 2 * Math.PI) / steps;
    const radius = inner && index % 2 ? inner : 1;
    raw.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
  }
  const xs = raw.map(([x]) => x);
  const ys = raw.map(([, y]) => y);
  const [minX, maxX] = [Math.min(...xs), Math.max(...xs)];
  const [minY, maxY] = [Math.min(...ys), Math.max(...ys)];
  return polygon(
    raw.map(([x, y]) => [
      ((x - minX) / (maxX - minX)) * width,
      ((y - minY) / (maxY - minY)) * height,
    ]),
  );
}

/**
 * The outline of a box shape as SVG path data, drawn in a `width` × `height`
 * box from its top-left corner. `detail` is an extra unfilled line, such as
 * the near rim of a cylinder. Rectangles and ellipses use native elements.
 */
export function shapeOutline(
  kind: BoardObject['kind'],
  width: number,
  height: number,
): { d: string; detail?: string } | undefined {
  const [w, h] = [width, height];
  switch (kind) {
    case 'diamond':
      return {
        d: polygon([
          [w / 2, 0],
          [w, h / 2],
          [w / 2, h],
          [0, h / 2],
        ]),
      };
    case 'triangle':
      return {
        d: polygon([
          [w / 2, 0],
          [w, h],
          [0, h],
        ]),
      };
    case 'right-triangle':
      return {
        d: polygon([
          [0, 0],
          [w, h],
          [0, h],
        ]),
      };
    case 'parallelogram': {
      const slant = Math.min(w * 0.25, h * 0.5);
      return {
        d: polygon([
          [slant, 0],
          [w, 0],
          [w - slant, h],
          [0, h],
        ]),
      };
    }
    case 'trapezoid': {
      const inset = Math.min(w * 0.22, h * 0.5);
      return {
        d: polygon([
          [inset, 0],
          [w - inset, 0],
          [w, h],
          [0, h],
        ]),
      };
    }
    case 'pentagon':
      return { d: radial(5, w, h) };
    case 'hexagon':
      return { d: radial(6, w, h, undefined, 0) };
    case 'star':
      return { d: radial(5, w, h, 0.45) };
    case 'cylinder': {
      const rim = round(Math.min(h * 0.14, w * 0.3));
      const rx = round(w / 2);
      return {
        d: `M0 ${rim}A${rx} ${rim} 0 0 1 ${w} ${rim}V${round(h - rim)}A${rx} ${rim} 0 0 1 0 ${round(h - rim)}Z`,
        detail: `M0 ${rim}A${rx} ${rim} 0 0 0 ${w} ${rim}`,
      };
    }
    case 'bubble': {
      // A rounded box with a tail pointing down from its lower left.
      const body = round(h * 0.8);
      const r = round(Math.min(12, w / 5, body / 3));
      const [from, to, tip] = [w * 0.22, w * 0.4, w * 0.14].map(round);
      return {
        d:
          `M${r} 0H${round(w - r)}Q${w} 0 ${w} ${r}V${round(body - r)}` +
          `Q${w} ${body} ${round(w - r)} ${body}H${to}L${tip} ${h}L${from} ${body}` +
          `H${r}Q0 ${body} 0 ${round(body - r)}V${r}Q0 0 ${r} 0Z`,
      };
    }
  }
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

/** Whether `outer` contains all of `inner`. */
export function encloses(outer: Bounds, inner: Bounds) {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
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

/**
 * Where objects without a known page live: the board's original first page
 * while it exists, so reordering pages never moves older objects.
 */
export function homePage(pages: readonly Page[]) {
  return pages.some((page) => page.id === 'p1') ? 'p1' : pages[0]!.id;
}

/** The page an object is shown on, given the board's current pages. */
export function pageOf(object: { page?: string }, pages: readonly Page[]) {
  return object.page && pages.some((page) => page.id === object.page)
    ? object.page
    : homePage(pages);
}
