'use client';

import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../../components/icons';
import type { BoxShape } from '../../lib/canvas';

/** Every closed shape, in the order the shapes menu shows them. */
export const SHAPE_TOOLS: { tool: BoxShape; label: string; key?: string }[] = [
  { tool: 'rect', label: 'Rectangle', key: 'R' },
  { tool: 'ellipse', label: 'Ellipse', key: 'O' },
  { tool: 'diamond', label: 'Diamond', key: 'D' },
  { tool: 'triangle', label: 'Triangle' },
  { tool: 'right-triangle', label: 'Right triangle' },
  { tool: 'parallelogram', label: 'Parallelogram' },
  { tool: 'trapezoid', label: 'Trapezoid' },
  { tool: 'pentagon', label: 'Pentagon' },
  { tool: 'hexagon', label: 'Hexagon' },
  { tool: 'star', label: 'Star' },
  { tool: 'cylinder', label: 'Cylinder' },
  { tool: 'bubble', label: 'Speech bubble' },
];
const COLUMNS = 4;
const GAP = 10;
const EDGE = 8;

/**
 * One dock button for every closed shape. It draws with the shape used last
 * and opens a menu of the rest, so the dock stays the same size.
 */
export function ShapePicker({
  tool,
  last,
  open,
  disabled,
  onOpenChange,
  onChoose,
}: {
  tool: string;
  last: BoxShape;
  open: boolean;
  disabled: boolean;
  onOpenChange: (open: boolean) => void;
  onChoose: (shape: BoxShape) => void;
}) {
  const [button, setButton] = useState<HTMLButtonElement | null>(null);
  const active = SHAPE_TOOLS.some((item) => item.tool === tool);
  const current = SHAPE_TOOLS.find((item) => item.tool === last)!;
  return (
    <>
      <button
        ref={setButton}
        className={`dock-tool shapes-tool ${active ? 'is-active' : ''}`}
        onClick={() => {
          onChoose(last);
          onOpenChange(!open);
        }}
        aria-pressed={active}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Shapes: ${current.label}`}
        data-tip={`Shapes · S`}
        disabled={disabled}
      >
        <Icon name={last} size={20} />
        <span className="shapes-caret" aria-hidden="true" />
        <kbd>S</kbd>
      </button>
      {open && button && (
        <ShapeMenu
          anchor={button}
          tool={tool}
          onClose={(refocus) => {
            onOpenChange(false);
            if (refocus) button.focus({ preventScroll: true });
          }}
          onChoose={(shape) => {
            onChoose(shape);
            onOpenChange(false);
          }}
        />
      )}
    </>
  );
}

function ShapeMenu({
  anchor,
  tool,
  onClose,
  onChoose,
}: {
  anchor: HTMLElement;
  tool: string;
  onClose: (refocus: boolean) => void;
  onChoose: (shape: BoxShape) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; bottom: number } | null>(
    null,
  );

  // Above the dock, centred on its button and kept inside the window.
  useLayoutEffect(() => {
    const menu = ref.current;
    if (!menu) return;
    const position = () => {
      const box = anchor.getBoundingClientRect();
      const { width } = menu.getBoundingClientRect();
      setPlace({
        left: Math.max(
          EDGE,
          Math.min(
            box.left + box.width / 2 - width / 2,
            window.innerWidth - EDGE - width,
          ),
        ),
        bottom: window.innerHeight - box.top + GAP,
      });
    };
    position();
    window.addEventListener('resize', position);
    return () => window.removeEventListener('resize', position);
  }, [anchor]);

  const placed = place !== null;
  useEffect(() => {
    if (!placed) return;
    const items = [
      ...(ref.current?.querySelectorAll<HTMLButtonElement>('button') ?? []),
    ];
    (
      items.find((item) => item.getAttribute('aria-checked') === 'true') ??
      items[0]
    )?.focus({ preventScroll: true });
  }, [placed]);

  // Stable listeners, as in the pages menu: the board's own key handler can
  // re-render the dock in the middle of a key press.
  const onPointer = useEffectEvent((event: PointerEvent) => {
    const target = event.target as Node;
    if (ref.current?.contains(target) || anchor.contains(target)) return;
    onClose(false);
  });
  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose(true);
      return;
    }
    if (event.key === 'Tab') return onClose(false);
    const items = [
      ...(ref.current?.querySelectorAll<HTMLButtonElement>('button') ?? []),
    ];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    const step =
      event.key === 'ArrowRight'
        ? 1
        : event.key === 'ArrowLeft'
          ? -1
          : event.key === 'ArrowDown'
            ? COLUMNS
            : event.key === 'ArrowUp'
              ? -COLUMNS
              : 0;
    if (!step) return;
    event.preventDefault();
    // Stops other handlers nudging the selection with the same arrow key.
    event.stopImmediatePropagation();
    items[(at + step + items.length) % items.length]!.focus();
  });
  useEffect(() => {
    const pointer = (event: PointerEvent) => onPointer(event);
    const key = (event: KeyboardEvent) => onKey(event);
    window.addEventListener('pointerdown', pointer, true);
    // Capture, so arrow keys reach the menu before the board moves things.
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('pointerdown', pointer, true);
      window.removeEventListener('keydown', key, true);
    };
  }, []);

  return createPortal(
    <div
      ref={ref}
      className="popover shape-menu"
      role="menu"
      aria-label="Shapes"
      style={
        place
          ? { left: place.left, bottom: place.bottom }
          : { left: 0, bottom: 0, visibility: 'hidden' }
      }
    >
      {SHAPE_TOOLS.map((item) => (
        <button
          key={item.tool}
          role="menuitemradio"
          aria-checked={tool === item.tool}
          aria-label={item.label}
          data-tip={item.key ? `${item.label} · ${item.key}` : item.label}
          className={`shape-option ${tool === item.tool ? 'is-active' : ''}`}
          onClick={() => onChoose(item.tool)}
        >
          <Icon name={item.tool} size={22} />
          {item.key && <kbd>{item.key}</kbd>}
        </button>
      ))}
    </div>,
    document.body,
  );
}
