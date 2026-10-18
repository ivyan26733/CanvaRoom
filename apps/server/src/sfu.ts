import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from './config.js';

/**
 * Voice through Cloudflare Realtime, a serverless SFU. Each person in a call
 * has one session there: they push their microphone into it as a track, and
 * pull everyone else's tracks through the same connection. The browser never
 * talks to Cloudflare's API itself; these calls carry the app token, so they
 * run here after the board's access checks.
 */

const BASE = 'https://rtc.live.cloudflare.com/v1/apps';

export const sfuConfigured = () => Boolean(config.sfu);

/** Cloudflare refused or failed the request; `status` is its HTTP status. */
export class SfuError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

type Description = { type: 'offer' | 'answer'; sdp: string };

type TrackResult = {
  mid?: string;
  trackName?: string;
  sessionId?: string;
  errorCode?: string;
  errorDescription?: string;
};

type CfResult = {
  sessionId?: string;
  sessionDescription?: Description;
  requiresImmediateRenegotiation?: boolean;
  tracks?: TrackResult[];
  errorCode?: string;
  errorDescription?: string;
};

async function cf(path: string, method: 'POST' | 'PUT', body?: unknown) {
  const sfu = config.sfu;
  if (!sfu) throw new SfuError('Voice calls are not configured.', 503);
  const response = await fetch(`${BASE}/${sfu.appId}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${sfu.token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(10_000),
  });
  const result = (await response.json().catch(() => ({}))) as CfResult;
  if (!response.ok || result.errorCode)
    throw new SfuError(
      result.errorDescription ?? `Cloudflare returned ${response.status}.`,
      response.ok ? 502 : response.status,
    );
  return result;
}

/**
 * Proves a Cloudflare session belongs to this person on this board, so later
 * requests about it need no server-side record (any instance can check it).
 */
export function sessionToken(
  boardId: string,
  userId: string,
  sessionId: string,
) {
  return createHmac('sha256', config.sfu?.token ?? '')
    .update(`sfu:${boardId}:${userId}:${sessionId}`)
    .digest('hex');
}

export function validSessionToken(
  boardId: string,
  userId: string,
  sessionId: string,
  token: string,
) {
  if (!config.sfu) return false;
  const expected = Buffer.from(sessionToken(boardId, userId, sessionId), 'hex');
  const given = Buffer.from(token, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Opens a session and pushes the microphone on the offer's `mid`. Returns the
 * answer to apply and the names others use to pull the track.
 */
export async function publish(offer: string, mid: string) {
  const session = await cf('/sessions/new', 'POST');
  if (!session.sessionId) throw new SfuError('No session was created.', 502);
  const trackName = `mic-${randomBytes(6).toString('hex')}`;
  const result = await cf(`/sessions/${session.sessionId}/tracks/new`, 'POST', {
    sessionDescription: { type: 'offer', sdp: offer },
    tracks: [{ location: 'local', mid, trackName }],
  });
  const track = result.tracks?.[0];
  if (track?.errorCode || !result.sessionDescription)
    throw new SfuError(
      track?.errorDescription ?? 'The microphone could not be published.',
      502,
    );
  return {
    sessionId: session.sessionId,
    trackName,
    answer: result.sessionDescription.sdp,
  };
}

/**
 * Pulls other people's microphones into this session. Cloudflare answers
 * with an offer to apply, plus the `mid` each track arrives on.
 */
export async function pull(
  sessionId: string,
  tracks: { sessionId: string; trackName: string }[],
) {
  const result = await cf(`/sessions/${sessionId}/tracks/new`, 'POST', {
    tracks: tracks.map((track) => ({ location: 'remote', ...track })),
  });
  return {
    offer: result.requiresImmediateRenegotiation
      ? result.sessionDescription?.sdp
      : undefined,
    tracks: (result.tracks ?? []).map((track) => ({
      mid: track.mid,
      sessionId: track.sessionId,
      trackName: track.trackName,
      error: track.errorCode ? (track.errorDescription ?? 'failed') : undefined,
    })),
  };
}

/** Sends the browser's answer to an offer Cloudflare made. */
export async function renegotiate(sessionId: string, answer: string) {
  await cf(`/sessions/${sessionId}/renegotiate`, 'PUT', {
    sessionDescription: { type: 'answer', sdp: answer },
  });
}

/** Stops pulling tracks the browser has already stopped locally. */
export async function closeTracks(
  sessionId: string,
  offer: string,
  mids: string[],
) {
  const result = await cf(`/sessions/${sessionId}/tracks/close`, 'PUT', {
    sessionDescription: { type: 'offer', sdp: offer },
    tracks: mids.map((mid) => ({ mid })),
    force: false,
  });
  return { answer: result.sessionDescription?.sdp };
}
