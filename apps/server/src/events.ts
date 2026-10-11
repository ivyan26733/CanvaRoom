import type { FastifyReply } from 'fastify';
import type { Presence } from './models.js';

const streams = new Map<string, Set<FastifyReply>>();
const presence = new Map<string, Map<string, Presence>>();

export function publish(boardId: string, event: unknown) {
  for (const reply of streams.get(boardId) ?? [])
    reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
}

export function addStream(boardId: string, reply: FastifyReply) {
  let boardStreams = streams.get(boardId);
  if (!boardStreams) streams.set(boardId, (boardStreams = new Set()));
  boardStreams.add(reply);
  reply.raw.on('close', () => {
    boardStreams?.delete(reply);
    if (boardStreams?.size === 0) streams.delete(boardId);
  });
}

export function updatePresence(boardId: string, item: Presence) {
  let boardPresence = presence.get(boardId);
  if (!boardPresence) presence.set(boardId, (boardPresence = new Map()));
  const previous = boardPresence.get(item.userId);
  boardPresence.set(item.userId, {
    ...previous,
    ...item,
    ...(item.x === undefined && previous?.x !== undefined
      ? { x: previous.x }
      : {}),
    ...(item.y === undefined && previous?.y !== undefined
      ? { y: previous.y }
      : {}),
  });
  const now = Date.now();
  for (const [id, peer] of boardPresence)
    if (now - peer.updatedAt > 15_000) boardPresence.delete(id);
  publish(boardId, { type: 'presence', peers: [...boardPresence.values()] });
}

export function peers(boardId: string) {
  const now = Date.now();
  const boardPresence = presence.get(boardId);
  if (!boardPresence) return [];
  for (const [id, peer] of boardPresence)
    if (now - peer.updatedAt > 15_000) boardPresence.delete(id);
  return [...boardPresence.values()];
}
