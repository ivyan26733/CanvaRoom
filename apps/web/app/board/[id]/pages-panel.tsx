'use client';

import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../../components/icons';
import type { BoardObject, Page, Peer } from '../../lib/api';
import { pageOf } from '../../lib/canvas';
import { usePeersByPage, type RemoteActivity } from './live-layers';

/** The list of pages on a board, with who is looking at each one. */
export function PagesPanel({
  pages,
  current,
  objects,
  activity,
  peers,
  readonly,
  onSelect,
  onAdd,
  onDuplicate,
  onRename,
  onDelete,
  onMove,
  onClose,
}: {
  pages: Page[];
  current: string;
  objects: BoardObject[];
  activity: RemoteActivity;
  peers: Peer[];
  readonly: boolean;
  onSelect: (pageId: string) => void;
  onAdd: () => void;
  onDuplicate: (page: Page) => void;
  onRename: (page: Page, name: string) => void;
  onDelete: (page: Page) => void;
  onMove: (page: Page, offset: number) => void;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  // The page whose actions are open, and the button that opened them.
  const [menu, setMenu] = useState<{
    pageId: string;
    anchor: HTMLElement;
  } | null>(null);
  const menuFor = menu?.pageId ?? null;
  const viewers = usePeersByPage(activity, peers, pages);
  const counts = useMemo(() => {
    const result = new Map<string, number>();
    for (const object of objects) {
      const page = pageOf(object, pages);
      result.set(page, (result.get(page) ?? 0) + 1);
    }
    return result;
  }, [objects, pages]);

  return (
    <aside className="pages-panel" aria-label="Pages">
      <div className="pages-head">
        <h2>
          Pages <span className="section-count">{pages.length}</span>
        </h2>
        <div>
          {!readonly && (
            <button
              className="icon-button"
              aria-label="Add page"
              title="Add page"
              onClick={onAdd}
            >
              <Icon name="plus" />
            </button>
          )}
          <button
            className="icon-button"
            aria-label="Close pages"
            onClick={onClose}
          >
            <Icon name="chevronLeft" />
          </button>
        </div>
      </div>
      <ol className="pages-list">
        {pages.map((page, index) => {
          const here = viewers.get(page.id) ?? [];
          const active = page.id === current;
          return (
            <li
              key={page.id}
              className={`page-item ${active ? 'is-active' : ''} ${menuFor === page.id ? 'menu-open' : ''}`}
            >
              {editing === page.id ? (
                <input
                  className="page-rename"
                  defaultValue={page.name}
                  maxLength={60}
                  autoFocus
                  aria-label="Page name"
                  onFocus={(event) => event.currentTarget.select()}
                  onBlur={(event) => {
                    onRename(page, event.currentTarget.value);
                    setEditing(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur();
                    if (event.key === 'Escape') setEditing(null);
                  }}
                />
              ) : (
                <button
                  className="page-button"
                  onClick={() => onSelect(page.id)}
                  onDoubleClick={() => !readonly && setEditing(page.id)}
                  aria-current={active ? 'page' : undefined}
                  title={
                    readonly
                      ? page.name
                      : `${page.name} · double-click to rename`
                  }
                >
                  <span className="page-index">{index + 1}</span>
                  <span className="page-name">{page.name}</span>
                  {here.length > 0 && (
                    <span
                      className="page-viewers"
                      aria-label={`${here.map((peer) => peer.name).join(', ')} here`}
                    >
                      {here.slice(0, 3).map((peer) => (
                        <span
                          key={peer.peerId}
                          style={{ background: peer.color }}
                          title={peer.name}
                        />
                      ))}
                    </span>
                  )}
                  <span className="page-count">{counts.get(page.id) ?? 0}</span>
                </button>
              )}
              {!readonly && editing !== page.id && (
                <div className="page-menu">
                  <button
                    className="icon-button"
                    aria-label={`Actions for ${page.name}`}
                    aria-haspopup="menu"
                    aria-expanded={menuFor === page.id}
                    onClick={(event) => {
                      const anchor = event.currentTarget;
                      setMenu((open) =>
                        open?.pageId === page.id
                          ? null
                          : { pageId: page.id, anchor },
                      );
                    }}
                  >
                    <Icon name="more" size={16} />
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {menu &&
        (() => {
          const index = pages.findIndex((page) => page.id === menu.pageId);
          const page = pages[index];
          if (!page) return null;
          return (
            <PageMenu
              key={page.id}
              anchor={menu.anchor}
              page={page}
              items={counts.get(page.id) ?? 0}
              first={index === 0}
              last={index === pages.length - 1}
              only={pages.length < 2}
              onClose={() => setMenu(null)}
              onRename={() => setEditing(page.id)}
              onDuplicate={() => onDuplicate(page)}
              onMove={(offset) => onMove(page, offset)}
              onDelete={() => onDelete(page)}
            />
          );
        })()}
      {!readonly && (
        <button className="add-page" onClick={onAdd}>
          <Icon name="plus" size={16} /> Add page
        </button>
      )}
    </aside>
  );
}

const GAP = 4;
const EDGE = 8;

/**
 * A page's actions. Drawn over everything, beside the button that opened it,
 * so the panel's scrolling list never clips it; it opens upwards when there
 * is no room below and always stays inside the window.
 */
function PageMenu({
  anchor,
  page,
  items,
  first,
  last,
  only,
  onClose,
  onRename,
  onDuplicate,
  onMove,
  onDelete,
}: {
  anchor: HTMLElement;
  page: Page;
  items: number;
  first: boolean;
  last: boolean;
  only: boolean;
  onClose: () => void;
  onRename: () => void;
  onDuplicate: () => void;
  onMove: (offset: number) => void;
  onDelete: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [confirming, setConfirming] = useState(false);
  const [place, setPlace] = useState<{
    top: number;
    left: number;
    up: boolean;
  } | null>(null);

  // Measured before paint, and again when the confirm step changes its size.
  useLayoutEffect(() => {
    const menu = ref.current;
    if (!menu) return;
    const position = () => {
      const button = anchor.getBoundingClientRect();
      const { width, height } = menu.getBoundingClientRect();
      const below = button.bottom + GAP;
      const up =
        below + height > window.innerHeight - EDGE &&
        button.top - GAP - height >= EDGE;
      const top = up
        ? button.top - GAP - height
        : Math.max(EDGE, Math.min(below, window.innerHeight - EDGE - height));
      const left = Math.max(
        EDGE,
        Math.min(button.right - width, window.innerWidth - EDGE - width),
      );
      setPlace({ top, left, up });
    };
    position();
    window.addEventListener('resize', position);
    return () => window.removeEventListener('resize', position);
  }, [anchor, confirming]);

  // Keyboard users land on the first action once it is placed (a hidden
  // element can't take focus); Esc returns them to the button.
  const placed = place !== null;
  useEffect(() => {
    if (!placed) return;
    ref.current
      ?.querySelector<HTMLButtonElement>('button:not(:disabled)')
      ?.focus({ preventScroll: true });
  }, [confirming, placed]);

  // One set of listeners for the menu's life. Re-adding them whenever the
  // panel re-renders could drop a key press: the board's own Escape handler
  // re-renders it in the middle of that very event.
  const close = useEffectEvent((refocus: boolean) => {
    onClose();
    if (refocus) anchor.focus({ preventScroll: true });
  });
  const onPointer = useEffectEvent((event: PointerEvent) => {
    const target = event.target as Node;
    if (ref.current?.contains(target) || anchor.contains(target)) return;
    close(false);
  });
  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (confirming) setConfirming(false);
      else close(true);
      return;
    }
    if (event.key === 'Tab') return close(false);
    const buttons = [
      ...(ref.current?.querySelectorAll<HTMLButtonElement>(
        'button:not(:disabled)',
      ) ?? []),
    ];
    if (!buttons.length) return;
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const move = (index: number) => {
      event.preventDefault();
      buttons[(index + buttons.length) % buttons.length]!.focus();
    };
    if (event.key === 'ArrowDown') move(at + 1);
    else if (event.key === 'ArrowUp') move(at < 0 ? -1 : at - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(-1);
  });
  // The list scrolling under it would leave it pointing at the wrong page.
  const onScroll = useEffectEvent((event: Event) => {
    if (ref.current?.contains(event.target as Node)) return;
    close(false);
  });
  useEffect(() => {
    const pointer = (event: PointerEvent) => onPointer(event);
    const key = (event: KeyboardEvent) => onKey(event);
    const scroll = (event: Event) => onScroll(event);
    window.addEventListener('pointerdown', pointer, true);
    window.addEventListener('keydown', key);
    window.addEventListener('scroll', scroll, true);
    return () => {
      window.removeEventListener('pointerdown', pointer, true);
      window.removeEventListener('keydown', key);
      window.removeEventListener('scroll', scroll, true);
    };
  }, []);

  const act = (action: () => void) => () => {
    onClose();
    action();
  };

  return createPortal(
    <div
      ref={ref}
      className={`popover page-popover ${place?.up ? 'is-up' : ''}`}
      role={confirming ? 'alertdialog' : 'menu'}
      aria-label={
        confirming ? `Delete ${page.name}?` : `Actions for ${page.name}`
      }
      style={
        place
          ? { top: place.top, left: place.left }
          : { top: 0, left: 0, visibility: 'hidden' }
      }
    >
      {confirming ? (
        <div className="page-confirm">
          <p>
            Delete <strong>{page.name}</strong>
            {items
              ? ` and its ${items} ${items === 1 ? 'item' : 'items'}`
              : ''}{' '}
            for everyone?
          </p>
          <div className="page-confirm-actions">
            <button
              className="button ghost"
              onClick={() => setConfirming(false)}
            >
              Cancel
            </button>
            <button className="button danger" onClick={act(onDelete)}>
              <Icon name="trash" size={16} /> Delete
            </button>
          </div>
        </div>
      ) : (
        <>
          <button className="menu-row" role="menuitem" onClick={act(onRename)}>
            <Icon name="edit" />
            <span>Rename</span>
          </button>
          <button
            className="menu-row"
            role="menuitem"
            onClick={act(onDuplicate)}
          >
            <Icon name="copy" />
            <span>Duplicate</span>
          </button>
          <button
            className="menu-row"
            role="menuitem"
            disabled={first}
            onClick={act(() => onMove(-1))}
          >
            <Icon name="chevronDown" className="flip" />
            <span>Move up</span>
          </button>
          <button
            className="menu-row"
            role="menuitem"
            disabled={last}
            onClick={act(() => onMove(1))}
          >
            <Icon name="chevronDown" />
            <span>Move down</span>
          </button>
          <div className="menu-divider" />
          <button
            className="menu-row danger"
            role="menuitem"
            disabled={only}
            title={only ? 'A board keeps at least one page' : undefined}
            onClick={() => (items ? setConfirming(true) : act(onDelete)())}
          >
            <Icon name="trash" />
            <span>Delete page</span>
          </button>
        </>
      )}
    </div>,
    document.body,
  );
}
