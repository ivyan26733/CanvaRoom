import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Account, SessionRecord, User } from './models.js';
import { store } from './store.js';

const COOKIE = 'cb_session';
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const SCRYPT = { N: 16384, r: 8, p: 1, keyLength: 64 };

export const PROFILE_COLORS = [
  '#2f8f68',
  '#d9772e',
  '#7a5cc4',
  '#d1495b',
  '#2f6fb0',
  '#b08300',
  '#1f8a99',
  '#c2457f',
];

function scrypt(password: string, salt: Buffer, options: ScryptOptions) {
  return new Promise<Buffer>((resolve, reject) =>
    scryptCallback(
      password.normalize('NFKC'),
      salt,
      SCRYPT.keyLength,
      { ...options, maxmem: 64 * 1024 * 1024 },
      (error, key) => (error ? reject(error) : resolve(key)),
    ),
  );
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const { N, r, p } = SCRYPT;
  const key = await scrypt(password, salt, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [scheme, N, r, p, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), {
    N: Number(N),
    r: Number(r),
    p: Number(p),
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// A precomputed hash lets sign-in spend the same time whether or not the
// email exists, so response timing does not reveal registered addresses.
let decoyHash: Promise<string> | undefined;
export function decoyPasswordHash() {
  return (decoyHash ??= hashPassword(randomBytes(16).toString('hex')));
}

/** Sessions are stored under a hash so a database leak exposes no cookies. */
const sessionKey = (token: string) =>
  createHash('sha256').update(token).digest('base64url');

export function publicUser(account: Account): User {
  return {
    id: account.id,
    name: account.name,
    color: account.color,
    email: account.email,
    guest: false,
  };
}

function readCookie(header: string | undefined) {
  for (const part of header?.split(';') ?? []) {
    const [name, ...value] = part.trim().split('=');
    if (name === COOKIE) return decodeURIComponent(value.join('='));
  }
}

function isHttps(request: IncomingMessage) {
  const forwarded = request.headers['x-forwarded-proto'];
  return (
    (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0] ===
      'https' || Boolean((request.socket as { encrypted?: boolean }).encrypted)
  );
}

function setCookie(
  request: IncomingMessage,
  response: FastifyReply,
  value: string,
  maxAge: number,
) {
  response.header(
    'Set-Cookie',
    [
      `${COOKIE}=${encodeURIComponent(value)}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      `Max-Age=${maxAge}`,
      ...(isHttps(request) ? ['Secure'] : []),
    ].join('; '),
  );
}

export async function startSession(
  request: FastifyRequest,
  reply: FastifyReply,
  user: User,
) {
  const token = randomBytes(32).toString('base64url');
  await store.createSession(
    sessionKey(token),
    user.guest
      ? { userId: user.id, guest: { name: user.name, color: user.color } }
      : { userId: user.id },
    SESSION_TTL_SECONDS,
  );
  setCookie(request.raw, reply, token, SESSION_TTL_SECONDS);
}

export async function endSession(request: FastifyRequest, reply: FastifyReply) {
  const token = readCookie(request.headers.cookie);
  if (token) await store.deleteSession(sessionKey(token));
  setCookie(request.raw, reply, '', 0);
}

/** The session key of the current request, to keep it when ending others. */
export function currentSessionKey(request: IncomingMessage) {
  const token = readCookie(request.headers.cookie);
  return token ? sessionKey(token) : undefined;
}

/** Resolves the signed-in person from the session cookie, if any. */
export async function userFromRequest(
  request: IncomingMessage,
): Promise<User | undefined> {
  const token = readCookie(request.headers.cookie);
  if (!token) return;
  const key = sessionKey(token);
  const found: { session: SessionRecord; account?: Account } | undefined =
    store.getSessionAccount
      ? await store.getSessionAccount(key)
      : await store.getSession(key).then((session) => session && { session });
  if (!found) return;
  const { session } = found;
  if (session.guest)
    return {
      id: session.userId,
      name: session.guest.name,
      color: session.guest.color,
      guest: true,
    };
  const account = store.getSessionAccount
    ? found.account
    : await store.getAccount(session.userId);
  return account ? publicUser(account) : undefined;
}

/**
 * Blocks cross-site use of the session cookie: state-changing requests and
 * WebSocket upgrades must come from a page on this site.
 */
export function sameOrigin(request: IncomingMessage) {
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    const host = (
      (request.headers['x-forwarded-host'] as string | undefined) ??
      request.headers.host ??
      ''
    )
      .split(',')[0]!
      .trim();
    const originUrl = new URL(origin);
    if (originUrl.host === host) return true;
    // Local development serves the app and the API on different ports.
    return (
      process.env.NODE_ENV !== 'production' &&
      originUrl.hostname === host.split(':')[0]
    );
  } catch {
    return false;
  }
}
