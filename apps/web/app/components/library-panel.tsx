'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DRAG_TYPE,
  formatBytes,
  installedPacks,
  installPack,
  itemSrc,
  loadManifest,
  packItems,
  recentItems,
  rememberRecent,
  removePack,
  thumbnailUrl,
  type ItemRef,
  type LibraryItem,
  type PackSummary,
} from '../lib/library';
import { Icon } from './icons';
import './library.css';

export type InsertRequest = ItemRef & LibraryItem;

function without<T>(record: Record<string, T>, key: string) {
  const next = { ...record };
  delete next[key];
  return next;
}

type Tab = 'mine' | 'browse';

function Thumb({ pack, item }: { pack: string; item: LibraryItem }) {
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    let live = true;
    void thumbnailUrl(pack, item.id).then((url) => live && setSrc(url));
    return () => {
      live = false;
    };
  }, [pack, item.id]);
  return src ? (
    // Plain SVGs from the browser's own copy; next/image has nothing to add.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" draggable={false} />
  ) : (
    <span className="lib-thumb-wait" />
  );
}

/**
 * The board library: installed packs to insert from, and the catalogue of
 * packs to install. Used as a drawer on boards and as a page of its own.
 */
export function LibraryPanel({
  synced,
  canInsert,
  onInsert,
  onClose,
  variant = 'drawer',
}: {
  /** Signed-in accounts keep their packs on the server. */
  synced: boolean;
  canInsert: boolean;
  onInsert?: (request: InsertRequest) => void;
  onClose?: () => void;
  variant?: 'drawer' | 'page';
}) {
  const [packs, setPacks] = useState<PackSummary[]>();
  const [installed, setInstalled] = useState<string[]>();
  const [items, setItems] = useState<Record<string, LibraryItem[]>>({});
  const [tab, setTab] = useState<Tab>(variant === 'page' ? 'browse' : 'mine');
  const [query, setQuery] = useState('');
  const [subject, setSubject] = useState('All');
  const [busy, setBusy] = useState<Record<string, number>>({});
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [recent, setRecent] = useState<ItemRef[]>([]);
  const [error, setError] = useState('');
  const [justInstalled, setJustInstalled] = useState<string>();
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    Promise.all([loadManifest(), installedPacks(synced)])
      .then(([all, mine]) => {
        if (!live) return;
        setPacks(all);
        const known = mine.filter((id) => all.some((pack) => pack.id === id));
        setInstalled(known);
        if (variant === 'drawer' && known.length === 0) setTab('browse');
      })
      .catch((caught: Error) => live && setError(caught.message));
    setRecent(recentItems());
    return () => {
      live = false;
    };
  }, [synced, variant]);

  // Item lists for installed packs, read from the browser's copy.
  useEffect(() => {
    if (!installed) return;
    let live = true;
    for (const packId of installed) {
      if (items[packId]) continue;
      packItems(packId)
        .then((list) => live && setItems((all) => ({ ...all, [packId]: list })))
        .catch(() => undefined);
    }
    return () => {
      live = false;
    };
  }, [installed, items]);

  const byId = useMemo(
    () => new Map((packs ?? []).map((pack) => [pack.id, pack])),
    [packs],
  );
  const subjects = useMemo(
    () => ['All', ...new Set((packs ?? []).map((pack) => pack.subject))],
    [packs],
  );

  async function install(packId: string) {
    setError('');
    setBusy((all) => ({ ...all, [packId]: 0 }));
    try {
      const next = await installPack(packId, synced, (fraction) =>
        setBusy((all) => ({ ...all, [packId]: fraction })),
      );
      setInstalled(next.filter((id) => byId.has(id)));
      setJustInstalled(packId);
    } catch (caught) {
      setError(
        (caught as Error).message || 'That pack could not be installed.',
      );
    } finally {
      setBusy((all) => without(all, packId));
    }
  }

  async function remove(packId: string) {
    setError('');
    setBusy((all) => ({ ...all, [packId]: -1 }));
    try {
      const next = await removePack(packId, synced);
      setInstalled(next.filter((id) => byId.has(id)));
      setItems((all) => without(all, packId));
      setRecent(recentItems());
    } catch (caught) {
      setError((caught as Error).message || 'That pack could not be removed.');
    } finally {
      setBusy((all) => without(all, packId));
    }
  }

  function insert(packId: string, item: LibraryItem) {
    if (!canInsert || !onInsert) return;
    rememberRecent({ pack: packId, item: item.id });
    setRecent(recentItems());
    onInsert({ pack: packId, item: item.id, ...item });
  }

  const needle = query.trim().toLowerCase();
  const matches = (pack: PackSummary, item: LibraryItem) =>
    !needle ||
    `${item.title} ${item.keywords} ${pack.title} ${pack.subject}`
      .toLowerCase()
      .includes(needle);

  const installedPacksList = (installed ?? [])
    .map((id) => byId.get(id))
    .filter((pack): pack is PackSummary => Boolean(pack));
  const recentTiles = recent
    .map((ref) => {
      const item = items[ref.pack]?.find((entry) => entry.id === ref.item);
      const pack = byId.get(ref.pack);
      return item && pack && installed?.includes(ref.pack)
        ? { pack, item }
        : undefined;
    })
    .filter((entry): entry is { pack: PackSummary; item: LibraryItem } =>
      Boolean(entry),
    );

  function tile(pack: PackSummary, item: LibraryItem) {
    return (
      <li key={`${pack.id}/${item.id}`}>
        <button
          type="button"
          className="lib-tile"
          style={{ '--pack': pack.color } as React.CSSProperties}
          disabled={!canInsert}
          draggable={canInsert}
          onClick={() => insert(pack.id, item)}
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = 'copy';
            event.dataTransfer.setData(
              DRAG_TYPE,
              JSON.stringify({ pack: pack.id, item: item.id, ...item }),
            );
          }}
          onDragEnd={(event) => {
            if (event.dataTransfer.dropEffect !== 'none') {
              rememberRecent({ pack: pack.id, item: item.id });
              setRecent(recentItems());
            }
          }}
          title={canInsert ? `Insert ${item.title}` : item.title}
          data-item={`${pack.id}/${item.id}`}
        >
          <span className="lib-thumb">
            <Thumb pack={pack.id} item={item} />
          </span>
          <span className="lib-tile-title">{item.title}</span>
        </button>
      </li>
    );
  }

  const mine = (
    <div className="lib-mine" role="tabpanel" aria-labelledby="lib-tab-mine">
      {installedPacksList.length === 0 ? (
        <div className="lib-empty">
          <div className="lib-empty-art" aria-hidden="true">
            <span style={{ '--pack': '#2d5bff' } as React.CSSProperties}>
              ∫
            </span>
            <span style={{ '--pack': '#2b8a3e' } as React.CSSProperties}>
              Fe
            </span>
            <span style={{ '--pack': '#e8590c' } as React.CSSProperties}>
              π
            </span>
          </div>
          <h3>Your library is empty — install a pack</h3>
          <p>
            Packs of formulas, tables and diagrams download only when you want
            them, then open instantly on any board.
          </p>
          <button
            type="button"
            className="button primary"
            onClick={() => setTab('browse')}
          >
            Browse packs
          </button>
        </div>
      ) : (
        <>
          <label className="lib-search">
            <Icon name="search" size={16} />
            <input
              ref={searchRef}
              type="search"
              placeholder="Search formulas, tables, diagrams…"
              aria-label="Search your library"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          {!canInsert && (
            <p className="lib-note">
              This board is view-only, so items can&apos;t be added here.
            </p>
          )}
          {!needle && recentTiles.length > 0 && (
            <section className="lib-section" aria-label="Recently used">
              <h3 className="lib-section-head">
                <span className="lib-dot" /> Recently used
              </h3>
              <ul className="lib-grid lib-recent">
                {recentTiles.map(({ pack, item }) => tile(pack, item))}
              </ul>
            </section>
          )}
          {installedPacksList.map((pack) => {
            const list = (items[pack.id] ?? []).filter((item) =>
              matches(pack, item),
            );
            if (needle && list.length === 0) return null;
            const open = needle !== '' || !collapsed.has(pack.id);
            return (
              <section
                key={pack.id}
                className={`lib-section ${justInstalled === pack.id ? 'is-new' : ''}`}
                style={{ '--pack': pack.color } as React.CSSProperties}
              >
                <h3 className="lib-section-head">
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() =>
                      setCollapsed((all) => {
                        const next = new Set(all);
                        if (next.has(pack.id)) next.delete(pack.id);
                        else next.add(pack.id);
                        return next;
                      })
                    }
                  >
                    <span className="lib-glyph">{pack.glyph}</span>
                    <span className="lib-section-title">{pack.title}</span>
                    <span className="lib-count">{list.length}</span>
                    <Icon name="chevronDown" size={14} />
                  </button>
                </h3>
                {open && (
                  <ul className="lib-grid">
                    {list.map((item) => tile(pack, item))}
                  </ul>
                )}
              </section>
            );
          })}
          {needle &&
            installedPacksList.every(
              (pack) =>
                !(items[pack.id] ?? []).some((item) => matches(pack, item)),
            ) && (
              <p className="lib-note">
                Nothing in your packs matches “{query.trim()}”.{' '}
                <button
                  type="button"
                  className="lib-link"
                  onClick={() => setTab('browse')}
                >
                  Browse more packs
                </button>
              </p>
            )}
        </>
      )}
    </div>
  );

  const browse = (
    <div
      className="lib-browse"
      role="tabpanel"
      aria-labelledby="lib-tab-browse"
    >
      <div className="lib-chips" role="group" aria-label="Subject">
        {subjects.map((name) => (
          <button
            key={name}
            type="button"
            className="lib-chip"
            aria-pressed={subject === name}
            onClick={() => setSubject(name)}
          >
            {name}
          </button>
        ))}
      </div>
      <ul className="lib-packs">
        {(packs ?? [])
          .filter((pack) => subject === 'All' || pack.subject === subject)
          .map((pack) => {
            const isInstalled = installed?.includes(pack.id) ?? false;
            const progress = busy[pack.id];
            const working = progress !== undefined;
            return (
              <li
                key={pack.id}
                className={`lib-pack ${isInstalled ? 'is-installed' : ''}`}
                style={{ '--pack': pack.color } as React.CSSProperties}
                data-pack={pack.id}
              >
                <div className="lib-cover" aria-hidden="true">
                  <span className="lib-cover-glyph">{pack.glyph}</span>
                  <div className="lib-cover-previews">
                    {pack.preview.map((itemId) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={itemId}
                        src={itemSrc(pack.id, itemId)}
                        alt=""
                        loading="lazy"
                        draggable={false}
                      />
                    ))}
                  </div>
                </div>
                <div className="lib-pack-body">
                  <p className="lib-subject">{pack.subject}</p>
                  <h3>{pack.title}</h3>
                  <p className="lib-desc">{pack.description}</p>
                  <p className="lib-meta">
                    {pack.items} items · {formatBytes(pack.bytes)}
                  </p>
                  <div className="lib-actions">
                    {isInstalled ? (
                      <>
                        <span className="lib-installed">
                          <Icon name="check" size={15} /> Installed
                        </span>
                        <button
                          type="button"
                          className="button ghost small"
                          disabled={working}
                          onClick={() => void remove(pack.id)}
                          aria-label={`Remove ${pack.title}`}
                        >
                          {working ? 'Removing…' : 'Remove'}
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="button primary small lib-install"
                        disabled={working}
                        onClick={() => void install(pack.id)}
                        aria-label={`Install ${pack.title}`}
                        style={
                          {
                            '--progress': `${Math.round((progress ?? 0) * 100)}%`,
                          } as React.CSSProperties
                        }
                      >
                        {working
                          ? `Installing ${Math.round((progress ?? 0) * 100)}%`
                          : 'Install'}
                      </button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
      </ul>
    </div>
  );

  return (
    <div className={`lib lib-${variant}`}>
      <header className="lib-head">
        <div className="lib-title">
          <span className="lib-title-icon">
            <Icon name="library" size={18} />
          </span>
          <div>
            <h2>Library</h2>
            <p>Formulas, tables and diagrams for teaching</p>
          </div>
          {onClose && (
            <button
              type="button"
              className="icon-button"
              aria-label="Close library"
              onClick={onClose}
            >
              <Icon name="close" />
            </button>
          )}
        </div>
        <div className="lib-tabs" role="tablist" aria-label="Library">
          <button
            type="button"
            role="tab"
            id="lib-tab-mine"
            aria-selected={tab === 'mine'}
            onClick={() => setTab('mine')}
          >
            My library
            {installed && installed.length > 0 && (
              <span className="lib-count">{installed.length}</span>
            )}
          </button>
          <button
            type="button"
            role="tab"
            id="lib-tab-browse"
            aria-selected={tab === 'browse'}
            onClick={() => setTab('browse')}
          >
            Browse
          </button>
        </div>
      </header>
      {error && (
        <p className="lib-error" role="alert">
          {error}
        </p>
      )}
      <div className="lib-body">
        {!packs || !installed ? (
          <p className="lib-note">Opening the library…</p>
        ) : tab === 'mine' ? (
          mine
        ) : (
          browse
        )}
      </div>
    </div>
  );
}
