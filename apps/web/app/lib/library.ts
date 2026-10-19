import { api, send } from './api';

/**
 * The board library: packs of ready-made formulas, tables and diagrams.
 *
 * Packs are static SVG files under /library/v<n>/, so nothing ships with the
 * board until someone installs a pack. Installing copies the pack into the
 * browser's Cache Storage, which keeps it instant and available offline;
 * removing deletes that copy. Which packs are installed is remembered on the
 * server for accounts, so it follows them to other devices, and in this
 * browser for guests and scratch boards.
 */

export const LIBRARY_VERSION = 1;
const BASE = `/library/v${LIBRARY_VERSION}`;
const CACHE = `canvaroom-library-v${LIBRARY_VERSION}`;
const LOCAL_KEY = 'canvaroom.library.installed';
const RECENT_KEY = 'canvaroom.library.recent';
const MAX_RECENT = 12;
export const DRAG_TYPE = 'application/x-canvaroom-library';

export type PackSummary = {
  id: string;
  title: string;
  subject: string;
  description: string;
  glyph: string;
  color: string;
  items: number;
  bytes: number;
  preview: string[];
};
export type LibraryItem = {
  id: string;
  title: string;
  keywords: string;
  width: number;
  height: number;
};
export type Pack = { id: string; version: number; items: LibraryItem[] };
export type ItemRef = { pack: string; item: string };

export const itemSrc = (pack: string, item: string) =>
  `${BASE}/${pack}/${item}.svg`;

let manifest: Promise<PackSummary[]> | undefined;
/** Every pack that can be installed. Small, so it is fetched each session. */
export function loadManifest() {
  manifest ??= fetch(`${BASE}/index.json`)
    .then((response) => {
      if (!response.ok) throw new Error('The library could not be loaded.');
      return response.json() as Promise<{ packs: PackSummary[] }>;
    })
    .then((data) => data.packs)
    .catch((error: unknown) => {
      manifest = undefined;
      throw error;
    });
  return manifest;
}

function readLocal(key: string): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? '[]') as unknown;
    return Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === 'string')
      : [];
  } catch {
    return [];
  }
}
function writeLocal(key: string, value: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Remembered for this visit only.
  }
}

async function openCache() {
  if (typeof caches === 'undefined') return null;
  try {
    return await caches.open(CACHE);
  } catch {
    return null;
  }
}

/** A pack's file, from the browser's copy when there is one. */
async function cached(url: string, store = false) {
  const cache = await openCache();
  const hit = await cache?.match(url);
  if (hit) return hit;
  const response = await fetch(url);
  if (!response.ok) throw new Error('Part of this pack could not be loaded.');
  if (store) await cache?.put(url, response.clone());
  return response;
}

/** The installed pack ids: the account's, or this browser's for guests. */
export async function installedPacks(synced: boolean) {
  if (!synced) return readLocal(LOCAL_KEY);
  try {
    const { packs } = await api<{ packs: string[] }>('/library');
    writeLocal(LOCAL_KEY, packs);
    return packs;
  } catch {
    // Offline: the last list this browser saw.
    return readLocal(LOCAL_KEY);
  }
}

export async function packItems(packId: string) {
  const response = await cached(`${BASE}/${packId}/pack.json`);
  return ((await response.json()) as Pack).items;
}

/**
 * Downloads a pack into the browser and records it as installed. Reports
 * progress as a fraction of the files fetched.
 */
export async function installPack(
  packId: string,
  synced: boolean,
  onProgress?: (fraction: number) => void,
) {
  const items = (
    (await (await cached(`${BASE}/${packId}/pack.json`, true)).json()) as Pack
  ).items;
  let done = 0;
  // A few at a time keeps the progress bar honest without flooding the network.
  const queue = [...items];
  await Promise.all(
    [...Array(4)].map(async () => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        await cached(itemSrc(packId, item.id), true);
        onProgress?.(++done / items.length);
      }
    }),
  );
  const local = readLocal(LOCAL_KEY);
  if (!local.includes(packId)) writeLocal(LOCAL_KEY, [...local, packId]);
  if (synced) {
    const { packs } = await send<{ packs: string[] }>(
      `/library/${encodeURIComponent(packId)}`,
      'PUT',
    );
    writeLocal(LOCAL_KEY, packs);
    return packs;
  }
  return readLocal(LOCAL_KEY);
}

/**
 * Removes a pack from this browser and from the account. Items already on
 * boards keep working: they point at files the site always serves.
 */
export async function removePack(packId: string, synced: boolean) {
  const cache = await openCache();
  if (cache) {
    const keys = await cache.keys();
    await Promise.all(
      keys
        .filter((request) =>
          new URL(request.url).pathname.startsWith(`${BASE}/${packId}/`),
        )
        .map((request) => cache.delete(request)),
    );
  }
  writeLocal(
    LOCAL_KEY,
    readLocal(LOCAL_KEY).filter((entry) => entry !== packId),
  );
  writeLocal(
    RECENT_KEY,
    readLocal(RECENT_KEY).filter((entry) => !entry.startsWith(`${packId}/`)),
  );
  if (synced) {
    const { packs } = await send<{ packs: string[] }>(
      `/library/${encodeURIComponent(packId)}`,
      'DELETE',
    );
    writeLocal(LOCAL_KEY, packs);
    return packs;
  }
  return readLocal(LOCAL_KEY);
}

/** Whether this browser still holds a pack's files (it may have cleared them). */
export async function isPackCached(packId: string) {
  const cache = await openCache();
  if (!cache) return false;
  return Boolean(await cache.match(`${BASE}/${packId}/pack.json`));
}

const objectUrls = new Map<string, Promise<string>>();
/**
 * An address for an item's picture in the drawer. It comes from the browser's
 * copy, so an installed pack shows without touching the network.
 */
export function thumbnailUrl(packId: string, itemId: string) {
  const src = itemSrc(packId, itemId);
  let url = objectUrls.get(src);
  if (!url) {
    url = cached(src)
      .then((response) => response.blob())
      .then((blob) => URL.createObjectURL(blob))
      .catch(() => src);
    objectUrls.set(src, url);
  }
  return url;
}

export function recentItems(): ItemRef[] {
  return readLocal(RECENT_KEY).map((entry) => {
    const [pack, item] = entry.split('/');
    return { pack: pack!, item: item! };
  });
}

export function rememberRecent(ref: ItemRef) {
  const key = `${ref.pack}/${ref.item}`;
  writeLocal(
    RECENT_KEY,
    [key, ...readLocal(RECENT_KEY).filter((entry) => entry !== key)].slice(
      0,
      MAX_RECENT,
    ),
  );
}

export function formatBytes(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
