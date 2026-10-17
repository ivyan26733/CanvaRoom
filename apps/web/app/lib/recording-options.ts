// What the recording setup needs before anyone records. Kept apart from the
// recorder itself so the board can load that only when recording starts.

export const RESOLUTIONS = [
  { height: 720, label: '720p', name: 'HD', mbps: 4 },
  { height: 1080, label: '1080p', name: 'Full HD', mbps: 8 },
  { height: 1440, label: '1440p', name: 'QHD', mbps: 12 },
  { height: 2160, label: '4K', name: 'Ultra HD', mbps: 20 },
] as const;

export type ResolutionHeight = (typeof RESOLUTIONS)[number]['height'];

export type RecordingOptions = {
  height: ResolutionHeight;
  microphone: boolean;
  callAudio: boolean;
};

/** Why recording cannot work in this browser, or null when it can. */
export function recordingUnsupported(): string | null {
  if (typeof window === 'undefined') return 'Recording is unavailable.';
  if (typeof MediaRecorder === 'undefined')
    return 'This browser cannot record video. Try Chrome, Edge, Firefox, or Safari 14.1+.';
  if (!('captureStream' in HTMLCanvasElement.prototype))
    return 'This browser cannot record the board. Try Chrome, Edge, or Firefox.';
  return null;
}
