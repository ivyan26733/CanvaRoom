// Copies accounts, sessions, and boards from Redis into Postgres, moving
// inline images into Blob storage on the way. Boards already in Postgres are
// skipped, so it is safe to run again.
//
// Needs REDIS_URL, DATABASE_URL, and BLOB_READ_WRITE_TOKEN.
import { createHash } from 'node:crypto';
import { saveImage, sniffImage } from '../src/images.js';
import type { BoardObject, SessionRecord } from '../src/models.js';
import { RedisStore, redis, storageKind, store } from '../src/store.js';

if (!redis || storageKind !== 'postgres')
  throw new Error('Set both REDIS_URL and DATABASE_URL.');
const source = new RedisStore(redis);

async function keysMatching(pattern: string) {
  const found: string[] = [];
  let cursor = '0';
  do {
    const [next, batch] = await redis!.scan(
      cursor,
      'MATCH',
      pattern,
      'COUNT',
      500,
    );
    cursor = next;
    found.push(...batch);
  } while (cursor !== '0');
  return found;
}

/** Replaces inline data URLs with uploaded images, once per distinct image. */
async function uploadInline(
  boardId: string,
  objects: BoardObject[],
  cache: Map<string, string>,
) {
  const result: BoardObject[] = [];
  for (const object of objects) {
    if (!object.src?.startsWith('data:')) {
      result.push(object);
      continue;
    }
    const digest = createHash('sha256').update(object.src).digest('hex');
    let src = cache.get(digest);
    if (!src) {
      const bytes = Buffer.from(object.src.split(',')[1] ?? '', 'base64');
      const type = sniffImage(bytes);
      if (!type) {
        console.warn(`  skipped an unreadable image on ${boardId}`);
        result.push(object);
        continue;
      }
      src = await saveImage(boardId, bytes, type);
      cache.set(digest, src);
    }
    result.push({ ...object, src });
  }
  return result;
}

let accounts = 0;
for (const key of await keysMatching('acct:*')) {
  const account = await source.getAccount(key.slice('acct:'.length));
  if (account && (await store.createAccount(account))) accounts++;
}

let sessions = 0;
for (const key of await keysMatching('sess:*')) {
  const [value, ttl] = await Promise.all([redis.get(key), redis.ttl(key)]);
  if (!value || ttl <= 0) continue;
  await store.createSession(
    key.slice('sess:'.length),
    JSON.parse(value) as SessionRecord,
    ttl,
  );
  sessions++;
}

let boards = 0;
let images = 0;
const boardKeys = (await keysMatching('b:*')).filter((key) =>
  /^b:[^:]+$/.test(key),
);
for (const key of boardKeys) {
  const boardId = key.slice(2);
  const meta = await source.getMeta(boardId);
  if (!meta || (await store.getMeta(boardId))) continue;
  const cache = new Map<string, string>();
  const objects = await uploadInline(
    boardId,
    await source.getObjects(boardId),
    cache,
  );
  await store.createBoard(meta, objects);
  for (const message of await source.getMessages(boardId))
    await store.addMessage(boardId, message);
  for (const snapshot of await source.getSnapshots(boardId))
    await store.addSnapshot(boardId, {
      ...snapshot,
      objects: await uploadInline(boardId, snapshot.objects, cache),
    });
  const tombstones = await redis.smembers(`b:${boardId}:tomb`);
  for (const objectId of tombstones)
    await store.applyOperation(boardId, {
      id: 'import',
      type: 'delete',
      objectId,
    });
  // Replaying deletions touched the board; keep its original activity time.
  await store.updateMeta(boardId, { updatedAt: meta.updatedAt });
  images += cache.size;
  boards++;
  console.log(`  ${meta.title} (${objects.length} objects)`);
}

console.log(
  `Imported ${accounts} accounts, ${sessions} sessions, ${boards} boards, ${images} images.`,
);
redis.disconnect();
process.exit(0);
