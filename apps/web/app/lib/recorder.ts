import { dataUrl } from './export';
import { layoutText, LINE_HEIGHT, STICKY_PADDING } from './canvas';

import {
  recordingUnsupported,
  RESOLUTIONS,
  type RecordingOptions,
  type ResolutionHeight,
} from './recording-options';

export { recordingUnsupported, RESOLUTIONS };
export type { RecordingOptions, ResolutionHeight };

const FPS = 30;
const TIMESLICE_MS = 1_000;
const BACKGROUND_TICK_MS = 1_000;

/** MP4 plays everywhere (QuickTime included), so it wins where supported. */
function pickFormat(withAudio: boolean) {
  const candidates = [
    ['video/mp4;codecs=avc1.640033,mp4a.40.2', 'mp4'],
    ['video/mp4;codecs=avc1,mp4a.40.2', 'mp4'],
    ['video/mp4;codecs=avc1.640033', 'mp4'],
    ['video/mp4;codecs=avc1', 'mp4'],
    ['video/mp4', 'mp4'],
    ['video/webm;codecs=vp9,opus', 'webm'],
    ['video/webm;codecs=vp8,opus', 'webm'],
    ['video/webm;codecs=vp9', 'webm'],
    ['video/webm', 'webm'],
  ] as const;
  for (const [mimeType, extension] of candidates) {
    // Without an audio track, skip types that name an audio codec.
    if (!withAudio && /mp4a|opus/.test(mimeType)) continue;
    if (MediaRecorder.isTypeSupported(mimeType)) return { mimeType, extension };
  }
  return { mimeType: '', extension: 'webm' };
}

function recordingName(title: string, extension: string) {
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'board';
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `canvaroom-${slug}-${stamp}.${extension}`;
}

function escapeXml(text: string) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** The dark-mode ink swaps from styles.css, for SVGs drawn outside the page. */
const DARK_INK = `[stroke='#1b1b1b']{stroke:#ecebe6}[fill='#1b1b1b']{fill:#ecebe6}[stroke='#1b1b1b66']{stroke:#ecebe666}[stroke='#1f2d27']{stroke:#ecebe6}[fill='#1f2d27']{fill:#ecebe6}.library-item{filter:invert(1) hue-rotate(180deg)}`;

type Region = { x: number; y: number; width: number; height: number };

/**
 * Records the board as the teacher sees it into a video file.
 *
 * Each frame is drawn from the live SVG stage into an offscreen canvas at the
 * chosen resolution, so the video stays sharp whatever the window size. The
 * stage is split into two images: committed objects, which change rarely,
 * and live activity (strokes in progress, cursors), which is small. While
 * someone draws, only the small one is re-rasterised, so recording does not
 * slow down the pen.
 */
export class SessionRecorder {
  readonly width: number;
  readonly height: number;
  private canvas = document.createElement('canvas');
  private context: CanvasRenderingContext2D;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private extension = 'webm';
  private mimeType = '';
  private audio: AudioContext | null = null;
  private audioDestination: MediaStreamAudioDestinationNode | null = null;
  private microphone: MediaStream | null = null;
  private callSources = new Map<string, MediaStreamAudioSourceNode>();
  private callTimer: ReturnType<typeof setInterval> | undefined;
  private observers: MutationObserver[] = [];
  private frame: number | undefined;
  private backgroundTimer: ReturnType<typeof setInterval> | undefined;
  private lastFrameAt = 0;
  private committedDirty = true;
  private liveDirty = true;
  private rendering = false;
  private committed: ImageBitmap | null = null;
  private live: ImageBitmap | null = null;
  private renderedRegion: Region | null = null;
  private lastViewBox = '';
  private images = new Map<string, string | Promise<void>>();
  private pointer: { x: number; y: number; down: boolean } | null = null;
  private paused = false;
  private stopped = false;
  private finished: Promise<void> | null = null;
  private detach: Array<() => void> = [];

  constructor(
    private readonly stage: SVGSVGElement,
    private readonly options: RecordingOptions,
    private readonly title: string,
    private readonly callStreams: () => MediaStream[],
    private readonly callMicrophone: () => MediaStream | null = () => null,
  ) {
    this.height = options.height;
    this.width = Math.round((options.height * 16) / 9);
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.context = this.canvas.getContext('2d', { alpha: false })!;
  }

  /** Starts recording. Resolves with a note when audio could not be added. */
  async start(): Promise<string> {
    let note = '';
    const inCall = this.options.microphone ? this.callMicrophone() : null;
    if (inCall) {
      // Opening the microphone a second time can silence the call's copy
      // (iOS allows one capture at a time), so record a copy of that one.
      this.microphone = new MediaStream(
        inCall.getAudioTracks().map((track) => track.clone()),
      );
    } else if (this.options.microphone) {
      try {
        this.microphone = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
      } catch {
        note = 'Microphone access was blocked, so this recording has no voice.';
      }
    }
    const wantsAudio = Boolean(this.microphone) || this.options.callAudio;
    if (wantsAudio) {
      this.audio = new AudioContext();
      void this.audio.resume().catch(() => undefined);
      this.audioDestination = this.audio.createMediaStreamDestination();
      if (this.microphone)
        this.audio
          .createMediaStreamSource(this.microphone)
          .connect(this.audioDestination);
      if (this.options.callAudio) {
        this.connectCallAudio();
        this.callTimer = setInterval(() => this.connectCallAudio(), 1_000);
      }
    }

    this.watchStage();
    this.paint(performance.now());
    const video = this.canvas.captureStream(FPS);
    const tracks = [
      ...video.getVideoTracks(),
      ...(this.audioDestination?.stream.getAudioTracks() ?? []),
    ];
    const format = pickFormat(tracks.length > 1);
    this.mimeType = format.mimeType;
    this.extension = format.extension;
    const resolution = RESOLUTIONS.find(
      (item) => item.height === this.options.height,
    )!;
    this.recorder = new MediaRecorder(new MediaStream(tracks), {
      ...(format.mimeType ? { mimeType: format.mimeType } : {}),
      videoBitsPerSecond: resolution.mbps * 1_000_000,
      audioBitsPerSecond: 160_000,
    });
    this.mimeType = this.recorder.mimeType || this.mimeType;
    if (this.mimeType.startsWith('video/mp4')) this.extension = 'mp4';
    this.recorder.ondataavailable = (event) => {
      if (event.data.size) this.chunks.push(event.data);
    };
    this.finished = new Promise<void>((resolve) => {
      this.recorder!.onstop = () => {
        this.save();
        resolve();
      };
    });
    // An encoder failure still hands back whatever was captured.
    this.recorder.onerror = () => void this.stop();
    this.recorder.start(TIMESLICE_MS);
    this.loop();
    return note;
  }

  get state() {
    return this.recorder?.state ?? 'inactive';
  }

  pause() {
    if (this.recorder?.state !== 'recording') return;
    this.recorder.pause();
    this.paused = true;
  }

  resume() {
    if (this.recorder?.state !== 'paused') return;
    this.paused = false;
    this.liveDirty = true;
    this.recorder.resume();
  }

  /** Stops recording and downloads the video. Safe to call more than once. */
  stop(): Promise<void> {
    if (!this.stopped) {
      this.stopped = true;
      if (this.recorder && this.recorder.state !== 'inactive') {
        try {
          this.recorder.requestData();
        } catch {
          // Already flushing.
        }
        this.recorder.stop();
      }
      this.teardown();
    }
    return this.finished ?? Promise.resolve();
  }

  private save() {
    if (!this.chunks.length) return;
    const blob = new Blob(this.chunks, {
      type: this.mimeType.split(';')[0] || 'video/webm',
    });
    this.chunks = [];
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = recordingName(this.title, this.extension);
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    // Large files need a moment before the browser has read them.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  private teardown() {
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    clearInterval(this.backgroundTimer);
    clearInterval(this.callTimer);
    for (const observer of this.observers) observer.disconnect();
    for (const undo of this.detach) undo();
    this.microphone?.getTracks().forEach((track) => track.stop());
    for (const source of this.callSources.values()) source.disconnect();
    // Let the recorder take the last audio before closing the graph.
    const audio = this.audio;
    setTimeout(() => void audio?.close().catch(() => undefined), 1_500);
    this.committed?.close();
    this.live?.close();
  }

  private connectCallAudio() {
    if (!this.audio || !this.audioDestination) return;
    const current = new Set<string>();
    for (const stream of this.callStreams()) {
      if (!stream.getAudioTracks().length) continue;
      current.add(stream.id);
      if (this.callSources.has(stream.id)) continue;
      const source = this.audio.createMediaStreamSource(stream);
      source.connect(this.audioDestination);
      this.callSources.set(stream.id, source);
    }
    for (const [id, source] of this.callSources)
      if (!current.has(id)) {
        source.disconnect();
        this.callSources.delete(id);
      }
  }

  // ---- Watching the board ----

  private watchStage() {
    const objects = this.stage.querySelector('.objects-layer');
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        const target = record.target as Element;
        const element =
          target.nodeType === Node.ELEMENT_NODE ? target : target.parentElement;
        if (
          element === this.stage ||
          (objects && objects.contains(element)) ||
          element?.closest('style, defs')
        )
          this.committedDirty = true;
        this.liveDirty = true;
      }
    });
    observer.observe(this.stage, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    this.observers.push(observer);

    // The text editor is an HTML textarea laid over the stage.
    const region = this.stage.parentElement;
    if (region) {
      const editors = new MutationObserver(() => (this.liveDirty = true));
      editors.observe(region, { childList: true });
      this.observers.push(editors);
      const onInput = () => (this.liveDirty = true);
      region.addEventListener('input', onInput, true);
      this.detach.push(() =>
        region.removeEventListener('input', onInput, true),
      );
    }

    const onMove = (event: PointerEvent) => {
      const world = this.toWorld(event.clientX, event.clientY);
      if (world)
        this.pointer = {
          ...world,
          down: event.buttons > 0 && event.pointerType !== 'touch',
        };
    };
    const onLeave = () => (this.pointer = null);
    this.stage.addEventListener('pointermove', onMove, { passive: true });
    this.stage.addEventListener('pointerdown', onMove, { passive: true });
    this.stage.addEventListener('pointerup', onMove, { passive: true });
    this.stage.addEventListener('pointerleave', onLeave);
    this.detach.push(() => {
      this.stage.removeEventListener('pointermove', onMove);
      this.stage.removeEventListener('pointerdown', onMove);
      this.stage.removeEventListener('pointerup', onMove);
      this.stage.removeEventListener('pointerleave', onLeave);
    });
  }

  private viewBox(): Region | null {
    const box = this.stage.viewBox.baseVal;
    if (!box || !box.width || !box.height) return null;
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  }

  private stageWidth() {
    return this.stage.getBoundingClientRect().width;
  }

  private toWorld(clientX: number, clientY: number) {
    const box = this.viewBox();
    const rect = this.stage.getBoundingClientRect();
    if (!box || !rect.width) return null;
    return {
      x: box.x + ((clientX - rect.left) / rect.width) * box.width,
      y: box.y + ((clientY - rect.top) / rect.height) * box.height,
    };
  }

  /** The visible board, widened to 16:9 so the video has no bars. */
  private region(): Region | null {
    const box = this.viewBox();
    if (!box) return null;
    const aspect = this.width / this.height;
    if (box.width / box.height > aspect) {
      const height = box.width / aspect;
      return { ...box, y: box.y - (height - box.height) / 2, height };
    }
    const width = box.height * aspect;
    return { ...box, x: box.x - (width - box.width) / 2, width };
  }

  // ---- Frames ----

  private loop() {
    const tick = (now: number) => {
      this.frame = requestAnimationFrame(tick);
      this.paint(now);
    };
    this.frame = requestAnimationFrame(tick);
    // Animation frames stop in a hidden tab; keep the video ticking anyway.
    this.backgroundTimer = setInterval(() => {
      if (document.hidden) this.paint(performance.now(), true);
    }, BACKGROUND_TICK_MS);
  }

  private paint(now: number, force = false) {
    if (this.paused || this.stopped) return;
    if (!force && now - this.lastFrameAt < 1000 / FPS - 2) return;
    this.lastFrameAt = now;

    const viewBox = this.stage.getAttribute('viewBox') ?? '';
    if (viewBox !== this.lastViewBox) {
      this.lastViewBox = viewBox;
      this.committedDirty = true;
      this.liveDirty = true;
    }
    if ((this.committedDirty || this.liveDirty) && !this.rendering)
      void this.render();

    const context = this.context;
    const styles = getComputedStyle(this.stage);
    context.fillStyle = styles.getPropertyValue('--canvas').trim() || '#f7f6f2';
    context.fillRect(0, 0, this.width, this.height);
    if (this.committed)
      context.drawImage(this.committed, 0, 0, this.width, this.height);
    if (this.live) context.drawImage(this.live, 0, 0, this.width, this.height);
    this.paintPointer();
  }

  /** A soft ring where the teacher is pointing, so viewers can follow. */
  private paintPointer() {
    const region = this.renderedRegion;
    if (!this.pointer || !region) return;
    const x = ((this.pointer.x - region.x) / region.width) * this.width;
    const y = ((this.pointer.y - region.y) / region.height) * this.height;
    const unit = this.height / 1080;
    const context = this.context;
    context.beginPath();
    context.arc(x, y, (this.pointer.down ? 9 : 12) * unit, 0, Math.PI * 2);
    context.fillStyle = this.pointer.down ? '#ff623655' : '#ff623633';
    context.fill();
    context.lineWidth = 2 * unit;
    context.strokeStyle = '#ff6236aa';
    context.stroke();
  }

  /**
   * Rasterises whichever layers changed. When both did, they are swapped in
   * together, so a finished stroke never blinks out between the two.
   */
  private async render() {
    const region = this.region();
    if (!region) return;
    this.rendering = true;
    const doCommitted = this.committedDirty;
    this.committedDirty = false;
    this.liveDirty = false;
    try {
      const css = this.css();
      const [committed, live] = await Promise.all([
        doCommitted
          ? this.rasterise(this.committedMarkup(region, css))
          : Promise.resolve(undefined),
        this.rasterise(this.liveMarkup(region, css)),
      ]);
      if (this.stopped) {
        committed?.close();
        live?.close();
        return;
      }
      if (committed !== undefined) {
        this.committed?.close();
        this.committed = committed;
      }
      this.live?.close();
      this.live = live ?? null;
      this.renderedRegion = region;
    } catch (error) {
      console.warn('Recording frame failed', error);
    } finally {
      this.rendering = false;
    }
  }

  private css() {
    const grid =
      getComputedStyle(this.stage).getPropertyValue('--grid').trim() ||
      '#c9c4b9';
    const pageStyles = [...this.stage.querySelectorAll('style')]
      .map((style) => style.textContent ?? '')
      .join('');
    const dark = document.documentElement.classList.contains('dark');
    return `<style>.grid-dot{fill:${grid}}[data-ui]{display:none}${dark ? DARK_INK : ''}${pageStyles}</style>`;
  }

  private open(region: Region, css: string) {
    return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${this.width}" height="${this.height}" viewBox="${region.x} ${region.y} ${region.width} ${region.height}">${css}`;
  }

  private committedMarkup(region: Region, css: string) {
    const serializer = new XMLSerializer();
    const defs = this.stage.querySelector('defs');
    const objects = this.stage.querySelector('.objects-layer');
    const view = this.viewBox();
    const showGrid = view ? this.stageWidth() / view.width > 0.15 : true;
    const grid = showGrid
      ? `<rect x="${region.x}" y="${region.y}" width="${region.width}" height="${region.height}" fill="url(#dot-grid)"/>`
      : '';
    const body = `${defs ? serializer.serializeToString(defs) : ''}${grid}${objects ? serializer.serializeToString(objects) : ''}`;
    return `${this.open(region, css)}${this.inlineImages(body)}</svg>`;
  }

  /** Null when nothing is happening live, so no image is needed. */
  private liveMarkup(region: Region, css: string) {
    const serializer = new XMLSerializer();
    const parts: string[] = [];
    const remote = this.stage.querySelector('.remote-layer');
    if (remote?.querySelector('.remote-drafts > *, .remote-cursor'))
      parts.push(serializer.serializeToString(remote));
    const local = this.stage.querySelector('.local-overlay');
    if (local?.querySelector(':scope > :not(style)'))
      parts.push(serializer.serializeToString(local));
    const editor = this.editorMarkup();
    if (editor) parts.push(editor);
    if (!parts.length) return null;
    return `${this.open(region, css)}${this.inlineImages(parts.join(''))}</svg>`;
  }

  /** Text being typed lives in a textarea; draw it like the finished shape. */
  private editorMarkup() {
    const editor = this.stage.parentElement?.querySelector<HTMLTextAreaElement>(
      '.canvas-text-editor',
    );
    const view = this.viewBox();
    if (!editor || !view) return '';
    const zoom = this.stageWidth() / view.width;
    const style = editor.style;
    const x = view.x + parseFloat(style.left || '0') / zoom;
    const y = view.y + parseFloat(style.top || '0') / zoom;
    const fontSize = parseFloat(style.fontSize || '28') / zoom;
    const sticky = editor.classList.contains('sticky-editor');
    const width = parseFloat(style.width || '0') / zoom;
    const height = parseFloat(style.height || '0') / zoom;
    const padding = sticky ? STICKY_PADDING : 0;
    const lines = layoutText(
      editor.value,
      fontSize,
      sticky ? width - STICKY_PADDING * 2 : undefined,
    ).lines;
    const lineHeight = fontSize * LINE_HEIGHT;
    const baseline = fontSize * ((LINE_HEIGHT - 1) / 2 + 0.8);
    const tspans = lines
      .map(
        (line, index) =>
          `<tspan x="${padding}" y="${baseline + index * lineHeight}">${escapeXml(line || ' ')}</tspan>`,
      )
      .join('');
    const tint = sticky
      ? (style.background.match(/#[0-9a-f]{6}/i)?.[0] ?? '#f5c84c')
      : '';
    const color = sticky ? '#22201c' : style.color || '#1b1b1b';
    const card = sticky
      ? `<rect width="${width}" height="${height}" rx="6" fill="#fffdf6"/><rect width="${width}" height="${height}" rx="6" fill="${tint}59" stroke="${tint}80"/>`
      : '';
    return `<g transform="translate(${x} ${y})">${card}<text fill="${escapeXml(color)}" font-size="${fontSize}" font-family="${escapeXml(style.fontFamily || 'sans-serif')}" transform="translate(0 ${padding})">${tspans}</text></g>`;
  }

  /**
   * An SVG drawn as an image cannot fetch files, so uploaded images are
   * swapped for data URLs. Until one has loaded, it is left out of the frame.
   */
  private inlineImages(markup: string) {
    return markup.replace(
      /(<image\b[^>]*?\shref=")([^"]+)(")/g,
      (match, start: string, href: string, end: string) => {
        if (href.startsWith('data:')) return match;
        // Only this site's own images are fetched, never another host.
        if (!href.startsWith('/') || href.startsWith('//'))
          return `${start}${end}`;
        const cached = this.images.get(href);
        if (typeof cached === 'string') return `${start}${cached}${end}`;
        if (!cached) this.images.set(href, this.loadImage(href));
        return `${start}${end}`;
      },
    );
  }

  private async loadImage(href: string) {
    try {
      const url = href.replace(/&amp;/g, '&');
      const response = await fetch(url, { credentials: 'same-origin' });
      if (!response.ok) throw new Error(String(response.status));
      this.images.set(href, await dataUrl(await response.blob()));
      this.committedDirty = true;
      this.liveDirty = true;
    } catch {
      this.images.delete(href);
    }
  }

  private async rasterise(markup: string | null) {
    if (!markup) return null;
    const url = URL.createObjectURL(
      new Blob([markup], { type: 'image/svg+xml' }),
    );
    try {
      const image = new Image(this.width, this.height);
      image.src = url;
      await image.decode();
      return await createImageBitmap(image, {
        resizeWidth: this.width,
        resizeHeight: this.height,
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}
