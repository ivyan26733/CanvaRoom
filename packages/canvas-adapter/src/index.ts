/** The small part of a board object the editor needs for viewport math. */
export interface CanvasItem {
  id: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  points?: number[];
  fontSize?: number;
}

export interface CanvasBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Engine-neutral operations exposed to the editor and collaboration layer. */
export interface CanvasAdapter<T extends CanvasItem = CanvasItem> {
  load(objects: readonly T[]): void;
  getBounds(): CanvasBounds | null;
  toCanvasPoint(
    clientX: number,
    clientY: number,
    rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
    view: { x: number; y: number; width: number; height: number },
  ): { x: number; y: number };
  destroy(): void;
}

/** Viewport adapter for the current native SVG canvas implementation. */
export class SvgCanvasAdapter<
  T extends CanvasItem = CanvasItem,
> implements CanvasAdapter<T> {
  private objects: readonly T[] = [];

  load(objects: readonly T[]) {
    this.objects = objects;
  }

  getBounds(): CanvasBounds | null {
    if (!this.objects.length) return null;
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const item of this.objects) {
      const points = item.points ?? [];
      const xs = points.filter((_, index) => index % 2 === 0);
      const ys = points.filter((_, index) => index % 2 === 1);
      const x = xs.length ? item.x + Math.min(0, ...xs) : item.x;
      const y = ys.length ? item.y + Math.min(0, ...ys) : item.y;
      const itemRight = xs.length
        ? item.x + Math.max(item.width ?? 0, ...xs)
        : item.x + (item.width ?? (item.fontSize ?? 30) * 4);
      const itemBottom = ys.length
        ? item.y + Math.max(item.height ?? 0, ...ys)
        : item.y + (item.height ?? item.fontSize ?? 40);
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, itemRight);
      bottom = Math.max(bottom, itemBottom);
    }
    return {
      x: left,
      y: top,
      width: Math.max(1, right - left),
      height: Math.max(1, bottom - top),
    };
  }

  toCanvasPoint(
    clientX: number,
    clientY: number,
    rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
    view: { x: number; y: number; width: number; height: number },
  ) {
    return {
      x: view.x + ((clientX - rect.left) / rect.width) * view.width,
      y: view.y + ((clientY - rect.top) / rect.height) * view.height,
    };
  }

  destroy() {
    this.objects = [];
  }
}
