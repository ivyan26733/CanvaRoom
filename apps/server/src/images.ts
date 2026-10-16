import { mkdir, readFile, rm, writeFile, cp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { copy, del, get, list, put } from '@vercel/blob';
import { config } from './config.js';
import type { BoardObject } from './models.js';

/**
 * Board images live in a private Vercel Blob store under `boards/{boardId}/`.
 * Boards refer to them by an app path, `/api/boards/{boardId}/images/{name}`,
 * which only the board's members can open. Without a Blob token (local
 * development) they are written to `data/images` instead.
 */

const TYPES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
} as const;
export type ImageType = keyof typeof TYPES;

const CONTENT_TYPES: Record<string, ImageType> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
};

export const MAX_IMAGE_BYTES = 1_500_000;
export const IMAGE_NAME = /^[0-9a-f-]{36}\.(?:png|jpg|webp)$/;
const PATH =
  /^\/api\/boards\/([A-Za-z0-9_-]{1,64})\/images\/([0-9a-f-]{36}\.(?:png|jpg|webp))$/;

const localRoot = resolve(process.cwd(), 'data/images');
const blobPath = (boardId: string, name: string) => `boards/${boardId}/${name}`;
export const imageSrc = (boardId: string, name: string) =>
  `/api/boards/${boardId}/images/${name}`;

/** The image type from its first bytes, so the declared type is not trusted. */
export function sniffImage(bytes: Buffer): ImageType | undefined {
  if (bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')))
    return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return 'image/jpeg';
  if (
    bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
    bytes.subarray(8, 12).toString('latin1') === 'WEBP'
  )
    return 'image/webp';
}

function storageAvailable() {
  if (config.blobEnabled || !process.env.VERCEL) return;
  throw new Error('Image storage is not configured.');
}

export async function saveImage(
  boardId: string,
  bytes: Buffer,
  type: ImageType,
) {
  storageAvailable();
  const name = `${randomUUID()}.${TYPES[type]}`;
  if (config.blobEnabled)
    await put(blobPath(boardId, name), bytes, {
      access: 'private',
      contentType: type,
      addRandomSuffix: false,
    });
  else {
    await mkdir(resolve(localRoot, boardId), { recursive: true });
    await writeFile(resolve(localRoot, boardId, name), bytes);
  }
  return imageSrc(boardId, name);
}

export async function readImage(boardId: string, name: string) {
  if (!IMAGE_NAME.test(name)) return;
  const contentType = CONTENT_TYPES[name.split('.').pop()!]!;
  if (config.blobEnabled) {
    const result = await get(blobPath(boardId, name), { access: 'private' });
    if (!result || result.statusCode !== 200) return;
    return {
      contentType,
      body: Buffer.from(await new Response(result.stream).arrayBuffer()),
    };
  }
  try {
    return {
      contentType,
      body: await readFile(resolve(localRoot, boardId, name)),
    };
  } catch {
    return;
  }
}

/**
 * Gives a duplicated board its own copies of the source board's images, so
 * deleting either board leaves the other intact.
 */
export async function copyImages(
  fromBoard: string,
  toBoard: string,
  objects: BoardObject[],
) {
  const names = new Set<string>();
  for (const object of objects) {
    const match = object.src && PATH.exec(object.src);
    if (match?.[1] === fromBoard) names.add(match[2]!);
  }
  if (names.size) {
    storageAvailable();
    if (config.blobEnabled)
      await Promise.all(
        [...names].map((name) =>
          copy(blobPath(fromBoard, name), blobPath(toBoard, name), {
            access: 'private',
            contentType: CONTENT_TYPES[name.split('.').pop()!]!,
            addRandomSuffix: false,
          }),
        ),
      );
    else
      await cp(resolve(localRoot, fromBoard), resolve(localRoot, toBoard), {
        recursive: true,
      }).catch(() => undefined);
  }
  return objects.map((object) => {
    const match = object.src && PATH.exec(object.src);
    return match?.[1] === fromBoard
      ? { ...object, src: imageSrc(toBoard, match[2]!) }
      : object;
  });
}

export async function deleteImages(boardId: string) {
  if (!config.blobEnabled) {
    if (!process.env.VERCEL)
      await rm(resolve(localRoot, boardId), { recursive: true, force: true });
    return;
  }
  let cursor: string | undefined;
  do {
    const page = await list({
      prefix: `boards/${boardId}/`,
      ...(cursor ? { cursor } : {}),
    });
    if (page.blobs.length) await del(page.blobs.map((blob) => blob.url));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
}
