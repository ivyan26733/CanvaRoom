import type { Peer } from './api';
import type { RealtimeClient } from './realtime';

type Signal =
  | { description: RTCSessionDescriptionInit }
  | { candidate: RTCIceCandidateInit | null }
  /** Start this pair's connection over (see `heal`). */
  | { reset: true };

type Link = {
  connection: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  /** Signals for one peer must be applied strictly in arrival order. */
  queue: Promise<void>;
  audio: HTMLAudioElement;
  analyser?: AnalyserNode | undefined;
  /** When the connection was last not working, or undefined while it is. */
  unhealthySince: number | undefined;
  /** Pending removal while the peer is missing from presence. */
  dropTimer?: ReturnType<typeof setTimeout> | undefined;
};

export type CallState = {
  joined: boolean;
  joining: boolean;
  muted: boolean;
  /** Peer IDs (including this tab's) that are talking right now. */
  speaking: Set<string>;
  /** Peer IDs whose audio connection is up. */
  connected: Set<string>;
  error: string;
};

const SPEAKING_LEVEL = 0.035;
/**
 * Board connections are recycled every few minutes, so a peer can vanish from
 * presence for a moment. Audio flows peer to peer and survives that, so the
 * link is only closed if they stay away.
 */
const DROP_GRACE_MS = 20_000;
/** A link that has not connected for this long is rebuilt from scratch. */
const HEAL_AFTER_MS = 12_000;

/**
 * Group voice over a full mesh of peer-to-peer WebRTC connections, signalled
 * through the board's WebSocket. Fine for classroom-sized groups (up to ~8);
 * larger rooms would need an SFU.
 *
 * To avoid two offers crossing (after which Chrome may never exchange ICE
 * candidates), only the "impolite" side of each pair makes the first offer;
 * the polite side attaches its microphone when it answers. Later
 * renegotiations, such as ICE restarts, use the "perfect negotiation" pattern.
 */
export class AudioCall {
  private links = new Map<string, Link>();
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private localAnalyser: AnalyserNode | null = null;
  private meterTimer: ReturnType<typeof setInterval> | undefined;
  private healTimer: ReturnType<typeof setInterval> | undefined;
  private state: CallState = {
    joined: false,
    joining: false,
    muted: false,
    speaking: new Set(),
    connected: new Set(),
    error: '',
  };

  constructor(
    private readonly client: RealtimeClient,
    private iceServers: RTCIceServer[],
    private readonly onChange: (state: CallState) => void,
  ) {}

  setIceServers(servers: RTCIceServer[]) {
    if (servers.length) this.iceServers = servers;
  }

  private update(patch: Partial<CallState>) {
    this.state = { ...this.state, ...patch };
    this.onChange(this.state);
  }

  async join() {
    if (this.state.joined || this.state.joining) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      this.update({
        error:
          'This browser cannot use a microphone here. Open the board over HTTPS.',
      });
      return;
    }
    this.update({ joining: true, error: '' });
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (error) {
      const name = (error as DOMException).name;
      this.update({
        joining: false,
        error:
          name === 'NotAllowedError'
            ? 'Microphone access was blocked. Allow it in your browser’s site settings, then try again.'
            : name === 'NotFoundError'
              ? 'No microphone was found.'
              : 'Could not start your microphone.',
      });
      return;
    }
    this.context = new AudioContext();
    this.localAnalyser = this.analyse(this.stream) ?? null;
    this.meterTimer = setInterval(() => this.measure(), 120);
    this.healTimer = setInterval(() => this.heal(), 3_000);
    this.update({ joined: true, joining: false, muted: false });
    this.client.setCall(true, false);
  }

  leave() {
    for (const peerId of [...this.links.keys()]) this.drop(peerId);
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    clearInterval(this.meterTimer);
    clearInterval(this.healTimer);
    void this.context?.close().catch(() => undefined);
    this.context = null;
    this.localAnalyser = null;
    this.update({
      joined: false,
      joining: false,
      muted: false,
      speaking: new Set(),
      connected: new Set(),
    });
    this.client.setCall(false, false);
  }

  setMuted(muted: boolean) {
    if (!this.state.joined) return;
    this.stream?.getAudioTracks().forEach((track) => (track.enabled = !muted));
    this.update({ muted });
    this.client.setCall(true, muted);
  }

  /** Connects to everyone else in the call and drops anyone who left it. */
  syncPeers(peers: Peer[]) {
    if (!this.state.joined) return;
    const inCall = new Set(
      peers
        .filter((peer) => peer.inCall && peer.peerId !== this.client.peerId)
        .map((peer) => peer.peerId),
    );
    for (const peerId of inCall) {
      const link = this.link(peerId);
      clearTimeout(link.dropTimer);
      link.dropTimer = undefined;
    }
    const present = new Set(peers.map((peer) => peer.peerId));
    for (const [peerId, link] of this.links) {
      if (inCall.has(peerId)) continue;
      // Someone who is here but left the call hung up on purpose.
      if (present.has(peerId)) this.drop(peerId);
      else
        link.dropTimer ??= setTimeout(() => this.drop(peerId), DROP_GRACE_MS);
    }
  }

  /**
   * Rebuilds links that never connected or stopped working, for example when
   * signals were lost while a board connection was being replaced. The
   * impolite side restarts the pair; the polite side asks it to.
   */
  private heal() {
    const now = Date.now();
    for (const [peerId, link] of [...this.links]) {
      if (link.dropTimer || link.unhealthySince === undefined) continue;
      if (now - link.unhealthySince < HEAL_AFTER_MS) continue;
      if (link.polite) {
        link.unhealthySince = now;
        this.client.sendSignal(peerId, { reset: true });
      } else this.restart(peerId);
    }
  }

  private restart(peerId: string) {
    this.drop(peerId);
    // The reset arrives before the new offer, on the same ordered socket.
    this.client.sendSignal(peerId, { reset: true });
    this.link(peerId);
  }

  handleSignal(from: string, data: unknown) {
    if (!this.state.joined) return;
    if ((data as { reset?: boolean } | null)?.reset) {
      const existing = this.links.get(from);
      if (existing?.polite ?? this.client.peerId < from) this.drop(from);
      else this.restart(from);
      return;
    }
    const link = this.link(from);
    // A candidate applied before its offer finishes would be rejected and
    // lost, which can leave the call silently unconnected.
    link.queue = link.queue.then(() =>
      this.applySignal(link, from, data as Signal),
    );
  }

  private async applySignal(link: Link, from: string, signal: Signal) {
    const { connection } = link;
    if (connection.signalingState === 'closed') return;
    try {
      if ('description' in signal) {
        const description = signal.description;
        const collision =
          description.type === 'offer' &&
          (link.makingOffer || connection.signalingState !== 'stable');
        link.ignoreOffer = !link.polite && collision;
        if (link.ignoreOffer) return;
        await connection.setRemoteDescription(description);
        if (description.type === 'offer') {
          await this.attachMicrophone(connection);
          await connection.setLocalDescription();
          this.client.sendSignal(from, {
            description: connection.localDescription!.toJSON(),
          });
        }
      } else if ('candidate' in signal && signal.candidate) {
        try {
          await connection.addIceCandidate(signal.candidate);
        } catch (error) {
          if (!link.ignoreOffer) throw error;
        }
      }
    } catch (error) {
      console.warn('Audio negotiation failed', error);
    }
  }

  private link(peerId: string): Link {
    const existing = this.links.get(peerId);
    if (existing) return existing;
    const connection = new RTCPeerConnection({ iceServers: this.iceServers });
    const audio = document.createElement('audio');
    audio.autoplay = true;
    audio.setAttribute('playsinline', '');
    audio.hidden = true;
    document.body.append(audio);
    const link: Link = {
      connection,
      polite: this.client.peerId < peerId,
      makingOffer: false,
      ignoreOffer: false,
      queue: Promise.resolve(),
      audio,
      unhealthySince: Date.now(),
    };
    this.links.set(peerId, link);

    if (!link.polite)
      for (const track of this.stream?.getTracks() ?? [])
        connection.addTrack(track, this.stream!);

    connection.onnegotiationneeded = async () => {
      // The polite side waits for the first offer instead of racing it.
      if (link.polite && !connection.remoteDescription) return;
      try {
        link.makingOffer = true;
        await connection.setLocalDescription();
        this.client.sendSignal(peerId, {
          description: connection.localDescription!.toJSON(),
        });
      } catch (error) {
        console.warn('Audio offer failed', error);
      } finally {
        link.makingOffer = false;
      }
    };
    connection.onicecandidate = ({ candidate }) =>
      this.client.sendSignal(peerId, {
        candidate: candidate?.toJSON() ?? null,
      });
    connection.ontrack = ({ streams, track }) => {
      const stream = streams[0] ?? new MediaStream([track]);
      audio.srcObject = stream;
      void audio.play().catch(() => undefined);
      link.analyser = this.analyse(stream);
    };
    connection.onconnectionstatechange = () => {
      const connected = new Set(this.state.connected);
      if (connection.connectionState === 'connected') {
        connected.add(peerId);
        link.unhealthySince = undefined;
      } else {
        connected.delete(peerId);
        link.unhealthySince ??= Date.now();
      }
      if (connection.connectionState === 'failed') connection.restartIce();
      this.update({ connected });
    };
    return link;
  }

  /** Sends this tab's microphone on the audio line the offer created. */
  private async attachMicrophone(connection: RTCPeerConnection) {
    const track = this.stream?.getAudioTracks()[0];
    if (!track) return;
    const transceivers = connection.getTransceivers();
    if (transceivers.some((transceiver) => transceiver.sender.track === track))
      return;
    const audio = transceivers.find(
      (transceiver) =>
        transceiver.receiver.track.kind === 'audio' &&
        !transceiver.sender.track,
    );
    if (!audio) {
      connection.addTrack(track, this.stream!);
      return;
    }
    audio.direction = 'sendrecv';
    await audio.sender.replaceTrack(track);
    audio.sender.setStreams?.(this.stream!);
  }

  private drop(peerId: string) {
    const link = this.links.get(peerId);
    if (!link) return;
    this.links.delete(peerId);
    clearTimeout(link.dropTimer);
    link.connection.close();
    link.audio.srcObject = null;
    link.audio.remove();
    const connected = new Set(this.state.connected);
    connected.delete(peerId);
    this.update({ connected });
  }

  private analyse(stream: MediaStream) {
    if (!this.context) return undefined;
    const analyser = this.context.createAnalyser();
    analyser.fftSize = 512;
    this.context.createMediaStreamSource(stream).connect(analyser);
    return analyser;
  }

  private measure() {
    const speaking = new Set<string>();
    const sample = new Float32Array(512);
    const level = (analyser?: AnalyserNode | null) => {
      if (!analyser) return 0;
      analyser.getFloatTimeDomainData(sample);
      let sum = 0;
      for (const value of sample) sum += value * value;
      return Math.sqrt(sum / sample.length);
    };
    if (!this.state.muted && level(this.localAnalyser) > SPEAKING_LEVEL)
      speaking.add(this.client.peerId);
    for (const [peerId, link] of this.links)
      if (level(link.analyser) > SPEAKING_LEVEL) speaking.add(peerId);
    const previous = this.state.speaking;
    if (
      speaking.size !== previous.size ||
      [...speaking].some((peerId) => !previous.has(peerId))
    )
      this.update({ speaking });
  }
}
