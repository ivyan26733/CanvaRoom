import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { User } from './models.js';

const secret =
  process.env.AUTH_SECRET ?? 'local-development-secret-change-before-deploy';
if (process.env.NODE_ENV === 'production' && !process.env.AUTH_SECRET) {
  throw new Error('AUTH_SECRET is required in production.');
}

export function issueSession(name: string) {
  const payload = Buffer.from(
    JSON.stringify({
      id: randomUUID(),
      name: name.trim().slice(0, 48),
      exp: Date.now() + 1000 * 60 * 60 * 24 * 14,
    }),
  ).toString('base64url');
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
}

export function verifySession(token: string | undefined): User | undefined {
  if (!token) return;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return;
  const expected = createHmac('sha256', secret).update(payload).digest();
  let actual: Buffer;
  try {
    actual = Buffer.from(signature, 'base64url');
  } catch {
    return;
  }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    return;
  try {
    const user = JSON.parse(
      Buffer.from(payload, 'base64url').toString(),
    ) as User & { exp: number };
    if (!user.id || !user.name || user.exp < Date.now()) return;
    return { id: user.id, name: user.name };
  } catch {
    return;
  }
}

export function requestUser(request: FastifyRequest): User | undefined {
  return verifySession(
    request.headers.authorization?.replace(/^Bearer\s+/i, ''),
  );
}
