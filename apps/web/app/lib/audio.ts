import type { Peer } from './api';
import type { RealtimeClient } from './realtime';

type Signal =
  | { description: RTCSessionDescriptionInit }
  | { candidate: RTCIceCandidateInit | null }
  /** Start this pair's connection over (see `heal`). */
  | { reset: true };

/** Someone whose voice this tab plays. */
export type Remote = {
  audio: HTMLAudioElement;
  /**
   * A copy of the peer's audio for the speaking meter and recordings. Safari
   * can stop playing a remote WebRTC track through its <audio> element once
   * that track is also fed into Web Audio, so the element gets the original.
   */
  tap?: MediaStream | undefined;
  analyser?: AnalyserNode | undefined;
};

type Link = Remote & {
  connection: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  /** Signals for one peer must be applied strictly in arrival order. */
  queue: Promise<void>;
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
  /** The browser refused to start playback until the page is tapped. */
  needsTap: boolean;
  /** The device paused the microphone (a phone call, Siri, the app hidden). */
  micPaused: boolean;
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

/** What the board page needs from a call, whichever way audio travels. */
export type VoiceCall = {
  join(): Promise<void>;
  leave(): void;
  setMuted(muted: boolean): void;
  setIceServers(servers: RTCIceServer[]): void;
  syncPeers(peers: Peer[]): void;
  handleSignal(from: string, data: unknown): void;
  remoteStreams(): MediaStream[];
  microphoneStream(): MediaStream | null;
  readonly joined: boolean;
};

/**
 * The microphone, the speaking meter, and playback of everyone else's voice,
 * shared by both ways of carrying a call: peer to peer, or through an SFU.
 */
export abstract class CallBase implements VoiceCall {
  protected stream: MediaStream | null = null;
  /** A copy of the microphone for the speaking meter. */
  private localTap: MediaStream | null = null;
  protected context: AudioContext | null = null;
  private localAnalyser: AnalyserNode | null = null;
  private reacquiring = false;
  private meterTimer: ReturnType<typeof setInterval> | undefined;
  protected state: CallState = {
    joined: false,
    joining: false,
    muted: false,
    speaking: new Set(),
    connected: new Set(),
    needsTap: false,
    micPaused: false,
    error: '',
  };

  constructor(
    protected readonly client: RealtimeClient,
    private readonly onChange: (state: CallState) => void,
  ) {}

  get joined() {
    return this.state.joined;
  }

  /** Everyone whose voice this tab plays, by peer ID. */
  protected abstract remotes(): Iterable<[string, Remote]>;
  /** Starts carrying the open microphone; false if that failed. */
  protected abstract connect(): Promise<boolean>;
  /** Tears down whatever `connect` and `syncPeers` set up. */
  protected abstract disconnect(): void;
  /** Puts a reopened microphone track on the air. */
  protected abstract useMicrophone(track: MediaStreamTrack): Promise<void>;
  abstract syncPeers(peers: Peer[]): void;

  /** Only peer-to-peer calls use these; the SFU brings its own. */
  setIceServers(servers: RTCIceServer[]) {
    void servers;
  }
  handleSignal(from: string, data: unknown) {
    void from;
    void data;
  }

  /** Tells the room whether this tab is in the call and muted. */
  protected announce() {
    this.client.setCall(this.state.joined, this.state.muted);
  }

  protected update(patch: Partial<CallState>) {
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
    // Created while the click that joined is still being handled: Safari,
    // and iOS in particular, keeps an AudioContext made later suspended.
    this.context = new AudioContext();
    void this.context.resume().catch(() => undefined);
    try {
      this.stream = await this.openMicrophone();
    } catch (error) {
      void this.context.close().catch(() => undefined);
      this.context = null;
      this.update({ joining: false, error: microphoneError(error) });
      return;
    }
    this.watchMicrophone();
    this.meterTimer = setInterval(() => this.measure(), 120);
    document.addEventListener('pointerdown', this.unlock, true);
    document.addEventListener('keydown', this.unlock, true);
    document.addEventListener('visibilitychange', this.onVisible);
    if (!(await this.connect())) {
      // Keeps the error `connect` showed.
      if (this.state.joining) this.leave();
      return;
    }
    // Hung up while connecting.
    if (!this.state.joining) return;
    this.update({ joined: true, joining: false, muted: false });
    this.announce();
  }

  protected openMicrophone() {
    return navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  }

  /** Meters the microphone and follows what the device does to it. */
  private watchMicrophone() {
    const track = this.stream?.getAudioTracks()[0];
    if (!track) return;
    this.localTap?.getTracks().forEach((item) => item.stop());
    this.localTap = new MediaStream([track.clone()]);
    this.localAnalyser = this.analyse(this.localTap) ?? null;
    track.onmute = () => this.update({ micPaused: true });
    track.onunmute = () => this.update({ micPaused: false });
    // iOS ends the capture after some interruptions; pick the mic up again.
    track.onended = () => void this.reacquire();
    this.update({ micPaused: track.muted });
  }

  /** Opens the microphone again and swaps it into every connection. */
  private async reacquire() {
    if (!this.state.joined || this.reacquiring) return;
    if (document.visibilityState === 'hidden') return; // Retried on return.
    this.reacquiring = true;
    try {
      const stream = await this.openMicrophone();
      if (!this.state.joined) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const track = stream.getAudioTracks()[0]!;
      track.enabled = !this.state.muted;
      this.stream?.getTracks().forEach((item) => item.stop());
      this.stream = stream;
      await this.useMicrophone(track);
      this.watchMicrophone();
    } catch (error) {
      this.update({ error: microphoneError(error) });
    } finally {
      this.reacquiring = false;
    }
  }

  /**
   * Retries anything the browser would only start after a tap: suspended
   * Web Audio and remote voices whose playback was refused.
   */
  private unlock = () => {
    if (this.context?.state !== 'running')
      void this.context?.resume().catch(() => undefined);
    for (const [, remote] of this.remotes()) this.play(remote);
  };

  private onVisible = () => {
    if (document.visibilityState !== 'visible') return;
    this.unlock();
    if (this.stream?.getAudioTracks()[0]?.readyState === 'ended')
      void this.reacquire();
  };

  /** Starts a remote voice, asking for a tap if the browser refuses. */
  protected play(remote: Remote) {
    if (!remote.audio.srcObject) return;
    const settled = () => {
      if (
        this.state.needsTap &&
        [...this.remotes()].every(
          ([, item]) => !item.audio.srcObject || !item.audio.paused,
        )
      )
        this.update({ needsTap: false });
    };
    if (!remote.audio.paused) return settled();
    remote.audio.play().then(settled, (error: DOMException) => {
      if (error.name === 'NotAllowedError') this.update({ needsTap: true });
    });
  }

  /** A hidden element that plays one remote voice. */
  protected audioElement() {
    const audio = document.createElement('audio');
    audio.autoplay = true;
    audio.setAttribute('playsinline', '');
    audio.hidden = true;
    document.body.append(audio);
    return audio;
  }

  /** Plays a remote track and meters a copy of it. */
  protected attach(
    remote: Remote,
    track: MediaStreamTrack,
    stream?: MediaStream,
  ) {
    remote.audio.srcObject = stream ?? new MediaStream([track]);
    this.play(remote);
    remote.tap?.getTracks().forEach((item) => item.stop());
    remote.tap = new MediaStream([track.clone()]);
    remote.analyser = this.analyse(remote.tap);
  }

  /** Stops playing a remote voice and removes its element. */
  protected detach(remote: Remote) {
    remote.audio.srcObject = null;
    remote.audio.remove();
    remote.tap?.getTracks().forEach((track) => track.stop());
    remote.tap = undefined;
    remote.analyser = undefined;
  }

  /** What this tab's microphone hears, for session recordings. */
  microphoneStream() {
    return this.state.joined ? this.stream : null;
  }

  leave() {
    this.disconnect();
    document.removeEventListener('pointerdown', this.unlock, true);
    document.removeEventListener('keydown', this.unlock, true);
    document.removeEventListener('visibilitychange', this.onVisible);
    for (const track of this.stream?.getTracks() ?? []) {
      track.onended = null;
      track.stop();
    }
    this.stream = null;
    this.localTap?.getTracks().forEach((track) => track.stop());
    this.localTap = null;
    clearInterval(this.meterTimer);
    void this.context?.close().catch(() => undefined);
    this.context = null;
    this.localAnalyser = null;
    const wasIn = this.state.joined;
    this.update({
      joined: false,
      joining: false,
      muted: false,
      speaking: new Set(),
      connected: new Set(),
      needsTap: false,
      micPaused: false,
    });
    if (wasIn) this.client.setCall(false, false);
  }

  setMuted(muted: boolean) {
    if (!this.state.joined) return;
    this.stream?.getAudioTracks().forEach((track) => (track.enabled = !muted));
    this.update({ muted });
    this.announce();
  }

  /** What everyone else in the call is saying, for session recordings. */
  remoteStreams() {
    return [...this.remotes()]
      .map(([, remote]) => remote.tap)
      .filter((stream): stream is MediaStream => stream instanceof MediaStream);
  }

  protected setConnected(peerId: string, connected: boolean) {
    if (this.state.connected.has(peerId) === connected) return;
    const next = new Set(this.state.connected);
    if (connected) next.add(peerId);
    else next.delete(peerId);
    this.update({ connected: next });
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
    for (const [peerId, remote] of this.remotes())
      if (level(remote.analyser) > SPEAKING_LEVEL) speaking.add(peerId);
    const previous = this.state.speaking;
    if (
      speaking.size !== previous.size ||
      [...speaking].some((peerId) => !previous.has(peerId))
    )
      this.update({ speaking });
  }
}

/**
 * Group voice over a full mesh of peer-to-peer WebRTC connections, signalled
 * through the board's WebSocket. Used when the server has no SFU set up; fine
 * for small groups.
 *
 * To avoid two offers crossing (after which Chrome may never exchange ICE
 * candidates), only the "impolite" side of each pair makes the first offer;
 * the polite side attaches its microphone when it answers. Later
 * renegotiations, such as ICE restarts, use the "perfect negotiation" pattern.
 */
export class AudioCall extends CallBase {
  private links = new Map<string, Link>();
  private healTimer: ReturnType<typeof setInterval> | undefined;

  constructor(
    client: RealtimeClient,
    private iceServers: RTCIceServer[],
    onChange: (state: CallState) => void,
  ) {
    super(client, onChange);
  }

  override setIceServers(servers: RTCIceServer[]) {
    if (servers.length) this.iceServers = servers;
  }

  protected remotes() {
    return this.links.entries();
  }

  protected async connect() {
    this.healTimer = setInterval(() => this.heal(), 3_000);
    return true;
  }

  protected disconnect() {
    for (const peerId of [...this.links.keys()]) this.drop(peerId);
    clearInterval(this.healTimer);
  }

  protected async useMicrophone(track: MediaStreamTrack) {
    for (const link of this.links.values())
      for (const sender of link.connection.getSenders())
        if (sender.track?.kind === 'audio' || sender.track === null)
          await sender.replaceTrack(track).catch(() => undefined);
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

  override handleSignal(from: string, data: unknown) {
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
    const link: Link = {
      connection,
      polite: this.client.peerId < peerId,
      makingOffer: false,
      ignoreOffer: false,
      queue: Promise.resolve(),
      audio: this.audioElement(),
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
    connection.ontrack = ({ streams, track }) =>
      this.attach(link, track, streams[0]);
    connection.onconnectionstatechange = () => {
      const up = connection.connectionState === 'connected';
      if (up) link.unhealthySince = undefined;
      else link.unhealthySince ??= Date.now();
      if (connection.connectionState === 'failed') connection.restartIce();
      this.setConnected(peerId, up);
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
    this.detach(link);
    this.setConnected(peerId, false);
  }
}

/** Explains why the microphone could not start, including OS-level blocks. */
export function microphoneError(error: unknown) {
  const { name, message } = error as DOMException;
  if (name === 'NotAllowedError')
    return /system/i.test(message)
      ? 'Your computer blocked the microphone for this browser. On a Mac, allow it in System Settings → Privacy & Security → Microphone, then try again.'
      : 'Microphone access was blocked. Allow it in your browser’s site settings (on iPhone: Settings → Safari → Microphone), then try again.';
  if (name === 'NotFoundError') return 'No microphone was found.';
  if (name === 'NotReadableError')
    return 'Your microphone is busy or could not start. Close other apps using it, then try again.';
  return 'Could not start your microphone.';
}
