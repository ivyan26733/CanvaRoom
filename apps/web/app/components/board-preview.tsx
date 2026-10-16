'use client';

import { useEffect, useRef, useState } from 'react';
import { BoardShape } from '../board/[id]/board-shape';
import { api, type BoardObject } from '../lib/api';
import { unionBounds } from '../lib/canvas';

type Preview = { pages: number; objects: BoardObject[] };
const cache = new Map<string, { at: string; preview: Preview }>();

/** A real, scaled-down render of a board's first page. */
export function BoardPreview({
  boardId,
  updatedAt,
}: {
  boardId: string;
  updatedAt: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const cached = cache.get(boardId);
  const [preview, setPreview] = useState<Preview | null>(
    cached?.at === updatedAt ? cached.preview : null,
  );

  useEffect(() => {
    if (preview) return;
    const element = ref.current;
    if (!element) return;
    let cancelled = false;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        observer.disconnect();
        api<Preview>(`/boards/${boardId}/preview`)
          .then((result) => {
            cache.set(boardId, { at: updatedAt, preview: result });
            if (!cancelled) setPreview(result);
          })
          .catch(() => !cancelled && setPreview({ pages: 1, objects: [] }));
      },
      { rootMargin: '200px' },
    );
    observer.observe(element);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [boardId, updatedAt, preview]);

  const bounds = preview ? unionBounds(preview.objects) : null;
  const pad = bounds ? Math.max(bounds.width, bounds.height) * 0.08 + 12 : 0;
  return (
    <div className="board-preview" ref={ref}>
      {bounds ? (
        <svg
          viewBox={`${bounds.x - pad} ${bounds.y - pad} ${bounds.width + pad * 2} ${bounds.height + pad * 2}`}
          preserveAspectRatio="xMidYMid meet"
          aria-hidden="true"
        >
          {preview!.objects.map((object) =>
            object.kind === 'image' ? (
              <rect
                key={object.id}
                x={object.x}
                y={object.y}
                width={object.width}
                height={object.height}
                rx="4"
                className="preview-image"
              />
            ) : (
              <BoardShape key={object.id} item={object} ghost />
            ),
          )}
        </svg>
      ) : (
        <div className={`preview-empty ${preview ? '' : 'is-loading'}`}>
          {preview ? 'Empty canvas' : ''}
        </div>
      )}
      {preview && preview.pages > 1 && (
        <span className="preview-pages">{preview.pages} pages</span>
      )}
    </div>
  );
}
