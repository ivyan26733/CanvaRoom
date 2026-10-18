import { send, type Peer } from './api';
import { CallBase, type CallState, type Remote } from './audio';
import type { CallAudio, RealtimeClient } from './realtime';

/** Someone else's microphone, pulled from the SFU. */
type Pulled = Remote & {
  /** `session/track`, so a republished microphone is noticed. */
  key: string;
  mid: string;
};

type Wanted = { peerId: string; sessionId: string; trackName: string };

const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.cloudflare.com:3478' }];
/** How long to wait for the connection to Cloudflare before giving up. */
const CONNECT_TIMEOUT_MS = 10_000;
/** A connection that stays down this long is rebuilt with a new session. */
const REBUILD_AFTER_MS = 8_000;
/** Someone missing from presence this long has left; stop pulling them. */
const DROP_GRACE_MS = 8_000;
/** Retries pulls that failed, such as a microphone not yet live. */
const CHECK_EVERY_MS = 2_500;

class Superseded extends Error {}

/**
 * Group voice through Cloudflare Realtime, a serverless SFU. This tab keeps
 * one connection to Cloudflare: it pushes its microphone up once, and pulls
 * each other person's microphone down through the same connection, so the
 * upload stays one stream however many people join.
 *
 * Every request to Cloudflare goes through the board's API, which holds the
 * app token and checks access. The microphone's session and track names are
 * shared through presence, signed by the server, so others can pull it.
 */
export class SfuCall extends CallBase {
  private pc: RTCPeerConnection | null = null;
  private sender: RTCRtpSender | null = null;
  private published: CallAudio | null = null;
  /** Remote microphones being played, by peer ID. */
  private pulled = new Map<string, Pulled>();
  /** Tracks that arrived before the pull that asked for them answered. */
  private early = new Map<string, MediaStreamTrack>();
  private peers: Peer[] = [];
  /** Who went missing from presence, and when. */
  private missingSince = new Map<string, number>();
  /** Negotiations run one at a time; each waits for the last. */
  private queue: Promise<unknown> = Promise.resolve();
  /** Bumped on each new connection, so work for an old one stops. */
  private generation = 0;
  private brokenSince: number | undefined;
  private checkTimer: ReturnType<typeof setInterval> | undefined;

  constructor(
    client: RealtimeClient,
    private readonly boardId: string,
    onChange: (state: CallState) => void,
  ) {
    super(client, onChange);
  }

  protected remotes() {
    return this.pulled.entries();
  }

  protected override announce() {
    this.client.setCall(
      this.state.joined,
      this.state.muted,
      this.state.joined ? (this.published ?? undefined) : undefined,
    );
  }

  private path(action: string) {
    return `/boards/${encodeURIComponent(this.boardId)}/call/${action}`;
  }

  protected async connect() {
    try {
      await this.publish();
    } catch (error) {
      if (error instanceof Superseded) return false;
      console.warn('Could not connect the call', error);
      this.update({
        error:
          'The call couldn’t connect. Check your connection and try again.',
      });
      return false;
    }
    this.checkTimer = setInterval(() => this.check(), CHECK_EVERY_MS);
    return true;
  }

  protected disconnect() {
    this.generation++;
    clearInterval(this.checkTimer);
    this.teardown();
    this.published = null;
    this.missingSince.clear();
  }

  protected async useMicrophone(track: MediaStreamTrack) {
    await this.sender?.replaceTrack(track).catch(() => undefined);
  }

  /** Closes the connection to Cloudflare and stops every remote voice. */
  private teardown() {
    this.pc?.close();
    this.pc = null;
    this.sender = null;
    for (const [peerId, remote] of this.pulled) {
      this.detach(remote);
      this.setConnected(peerId, false);
    }
    this.pulled.clear();
    this.early.clear();
    this.brokenSince = undefined;
  }

  /**
   * Opens a session on Cloudflare with the microphone as its one outgoing
   * track, and waits for the connection to come up.
   */
  private async publish() {
    const generation = ++this.generation;
    const track = this.stream?.getAudioTracks()[0];
    if (!track) throw new Error('No microphone');
    const pc = new RTCPeerConnection({
      iceServers: ICE_SERVERS,
      bundlePolicy: 'max-bundle',
    });
    this.pc = pc;
    const transceiver = pc.addTransceiver(track, { direction: 'sendonly' });
    this.sender = transceiver.sender;
    pc.ontrack = ({ transceiver: incoming, track: remote }) =>
      this.received(incoming.mid, remote);
    pc.onconnectionstatechange = () => this.connectionChanged(pc);
    await pc.setLocalDescription(await pc.createOffer());
    const result = await send<{
      sessionId: string;
      trackName: string;
      token: string;
      answer: string;
    }>(this.path('publish'), 'POST', {
      sdp: pc.localDescription!.sdp,
      mid: transceiver.mid,
    });
    if (generation !== this.generation) throw new Superseded();
    await pc.setRemoteDescription({ type: 'answer', sdp: result.answer });
    await connected(pc);
    if (generation !== this.generation) throw new Superseded();
    this.published = {
      session: result.sessionId,
      track: result.trackName,
      token: result.token,
    };
  }

  syncPeers(peers: Peer[]) {
    this.peers = peers;
    if (this.state.joined) this.enqueue(() => this.reconcile());
  }

  private enqueue(task: () => Promise<void>) {
    const generation = this.generation;
    this.queue = this.queue
      .then(() => (generation === this.generation ? task() : undefined))
      .catch((error: unknown) => {
        if (!(error instanceof Superseded))
          console.warn('Call negotiation failed', error);
      });
  }

  /** Retries failed pulls and rebuilds a connection that stayed down. */
  private check() {
    if (!this.state.joined) return;
    const pc = this.pc;
    if (
      pc &&
      (pc.connectionState === 'failed' ||
        (this.brokenSince !== undefined &&
          Date.now() - this.brokenSince > REBUILD_AFTER_MS))
    ) {
      this.enqueue(() => this.rebuild());
      return;
    }
    this.enqueue(() => this.reconcile());
  }

  /** Starts over with a new session, then pulls everyone again. */
  private async rebuild() {
    this.teardown();
    try {
      await this.publish();
    } catch (error) {
      if (error instanceof Superseded) throw error;
      // Tried again on the next check.
      this.brokenSince = Date.now() - REBUILD_AFTER_MS;
      throw error;
    }
    this.announce();
    await this.reconcile();
  }

  private connectionChanged(pc: RTCPeerConnection) {
    if (pc !== this.pc) return;
    const up = pc.connectionState === 'connected';
    if (up) this.brokenSince = undefined;
    else if (
      pc.connectionState !== 'new' &&
      pc.connectionState !== 'connecting'
    )
      this.brokenSince ??= Date.now();
    for (const [peerId, remote] of this.pulled)
      this.setConnected(peerId, up && Boolean(remote.audio.srcObject));
  }

  /** A pulled track arrived on the connection. */
  private received(mid: string | null, track: MediaStreamTrack) {
    if (!mid) return;
    const entry = [...this.pulled].find(([, remote]) => remote.mid === mid);
    if (!entry) {
      this.early.set(mid, track);
      return;
    }
    const [peerId, remote] = entry;
    this.attach(remote, track);
    this.setConnected(peerId, this.pc?.connectionState === 'connected');
  }

  /**
   * Pulls the microphone of everyone in the call and stops pulling anyone
   * who left it or republished.
   */
  private async reconcile() {
    const pc = this.pc;
    const session = this.published;
    if (!pc || !session || pc.signalingState !== 'stable') return;
    const now = Date.now();
    const present = new Set(this.peers.map((peer) => peer.peerId));
    const wanted = new Map<string, Wanted>();
    for (const peer of this.peers)
      if (peer.inCall && peer.audio && peer.peerId !== this.client.peerId)
        wanted.set(peer.peerId, {
          peerId: peer.peerId,
          sessionId: peer.audio.session,
          trackName: peer.audio.track,
        });

    const stale: string[] = [];
    for (const [peerId, remote] of this.pulled) {
      const want = wanted.get(peerId);
      if (want && `${want.sessionId}/${want.trackName}` === remote.key) {
        this.missingSince.delete(peerId);
        continue;
      }
      if (!want && !present.has(peerId)) {
        // Briefly missing while their board connection is replaced.
        const since = this.missingSince.get(peerId) ?? now;
        this.missingSince.set(peerId, since);
        if (now - since < DROP_GRACE_MS) continue;
      }
      stale.push(peerId);
    }
    if (stale.length) await this.close(pc, session, stale);

    const missing = [...wanted.values()].filter(
      (want) => !this.pulled.has(want.peerId),
    );
    if (missing.length) await this.pull(pc, session, missing);
  }

  private async pull(
    pc: RTCPeerConnection,
    session: CallAudio,
    wanted: Wanted[],
  ) {
    const generation = this.generation;
    const result = await send<{
      offer?: string;
      tracks: {
        mid?: string;
        sessionId?: string;
        trackName?: string;
        error?: string;
      }[];
    }>(this.path('pull'), 'POST', {
      sessionId: session.session,
      token: session.token,
      tracks: wanted.map(({ sessionId, trackName }) => ({
        sessionId,
        trackName,
      })),
    });
    if (generation !== this.generation || pc !== this.pc)
      throw new Superseded();
    for (const track of result.tracks) {
      if (track.error || !track.mid) continue; // Retried on the next check.
      const want = wanted.find(
        (item) =>
          item.sessionId === track.sessionId &&
          item.trackName === track.trackName,
      );
      if (!want) continue;
      const remote: Pulled = {
        key: `${want.sessionId}/${want.trackName}`,
        mid: track.mid,
        audio: this.audioElement(),
      };
      this.pulled.set(want.peerId, remote);
      this.missingSince.delete(want.peerId);
    }
    if (!result.offer) return;
    await pc.setRemoteDescription({ type: 'offer', sdp: result.offer });
    await pc.setLocalDescription(await pc.createAnswer());
    await send(this.path('renegotiate'), 'POST', {
      sessionId: session.session,
      token: session.token,
      sdp: pc.localDescription!.sdp,
    });
    // Tracks whose `ontrack` fired before their mid was known.
    for (const [peerId, remote] of this.pulled) {
      const track = this.early.get(remote.mid);
      if (!track) continue;
      this.early.delete(remote.mid);
      this.attach(remote, track);
      this.setConnected(peerId, pc.connectionState === 'connected');
    }
  }

  /** Stops pulling the given people's microphones. */
  private async close(
    pc: RTCPeerConnection,
    session: CallAudio,
    peerIds: string[],
  ) {
    const mids: string[] = [];
    for (const peerId of peerIds) {
      const remote = this.pulled.get(peerId);
      if (!remote) continue;
      this.pulled.delete(peerId);
      this.missingSince.delete(peerId);
      this.detach(remote);
      this.setConnected(peerId, false);
      const transceiver = pc
        .getTransceivers()
        .find((item) => item.mid === remote.mid);
      if (transceiver && transceiver.currentDirection !== 'stopped') {
        transceiver.stop();
        mids.push(remote.mid);
      }
    }
    if (!mids.length) return;
    const generation = this.generation;
    await pc.setLocalDescription(await pc.createOffer());
    try {
      const result = await send<{ answer?: string }>(
        this.path('close'),
        'POST',
        {
          sessionId: session.session,
          token: session.token,
          sdp: pc.localDescription!.sdp,
          mids,
        },
      );
      if (generation !== this.generation || pc !== this.pc)
        throw new Superseded();
      if (result.answer)
        await pc.setRemoteDescription({ type: 'answer', sdp: result.answer });
    } catch (error) {
      // Leave the connection usable for the next pull.
      if (pc.signalingState === 'have-local-offer')
        await pc
          .setLocalDescription({ type: 'rollback' })
          .catch(() => undefined);
      throw error;
    }
  }
}

/** Resolves once the connection is up, or rejects after a timeout. */
function connected(pc: RTCPeerConnection) {
  if (pc.connectionState === 'connected') return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      pc.removeEventListener('connectionstatechange', changed);
      reject(new Error('Timed out connecting to the call server'));
    }, CONNECT_TIMEOUT_MS);
    function changed() {
      if (pc.connectionState === 'connected') {
        clearTimeout(timer);
        pc.removeEventListener('connectionstatechange', changed);
        resolve();
      } else if (
        pc.connectionState === 'failed' ||
        pc.connectionState === 'closed'
      ) {
        clearTimeout(timer);
        pc.removeEventListener('connectionstatechange', changed);
        reject(new Error(`Call connection ${pc.connectionState}`));
      }
    }
    pc.addEventListener('connectionstatechange', changed);
  });
}
