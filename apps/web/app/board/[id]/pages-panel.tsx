'use client';

import { useMemo, useRef, useState } from 'react';
import { Icon } from '../../components/icons';
import { useDismiss } from '../../components/user-menu';
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
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useDismiss(menuFor !== null, () => setMenuFor(null), menuRef);
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
                <div
                  className="page-menu"
                  ref={menuFor === page.id ? menuRef : undefined}
                >
                  <button
                    className="icon-button"
                    aria-label={`Actions for ${page.name}`}
                    aria-expanded={menuFor === page.id}
                    onClick={() =>
                      setMenuFor((open) => (open === page.id ? null : page.id))
                    }
                  >
                    <Icon name="more" size={16} />
                  </button>
                  {menuFor === page.id && (
                    <div className="popover" role="menu">
                      <button
                        className="menu-row"
                        role="menuitem"
                        onClick={() => {
                          setMenuFor(null);
                          setEditing(page.id);
                        }}
                      >
                        <Icon name="edit" />
                        <span>Rename</span>
                      </button>
                      <button
                        className="menu-row"
                        role="menuitem"
                        onClick={() => {
                          setMenuFor(null);
                          onDuplicate(page);
                        }}
                      >
                        <Icon name="copy" />
                        <span>Duplicate</span>
                      </button>
                      <button
                        className="menu-row"
                        role="menuitem"
                        disabled={index === 0}
                        onClick={() => {
                          setMenuFor(null);
                          onMove(page, -1);
                        }}
                      >
                        <Icon name="chevronDown" className="flip" />
                        <span>Move up</span>
                      </button>
                      <button
                        className="menu-row"
                        role="menuitem"
                        disabled={index === pages.length - 1}
                        onClick={() => {
                          setMenuFor(null);
                          onMove(page, 1);
                        }}
                      >
                        <Icon name="chevronDown" />
                        <span>Move down</span>
                      </button>
                      <div className="menu-divider" />
                      <button
                        className="menu-row danger"
                        role="menuitem"
                        disabled={pages.length < 2}
                        onClick={() => {
                          setMenuFor(null);
                          onDelete(page);
                        }}
                      >
                        <Icon name="trash" />
                        <span>Delete page</span>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {!readonly && (
        <button className="add-page" onClick={onAdd}>
          <Icon name="plus" size={16} /> Add page
        </button>
      )}
    </aside>
  );
}
