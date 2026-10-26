'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../../components/icons';
import { Modal } from '../../components/modal';
import type { SessionRecorder } from '../../lib/recorder';
import {
  RESOLUTIONS,
  recordingUnsupported,
  type ResolutionHeight,
} from '../../lib/recording-options';

const PREFERENCE_KEY = 'canvasroom.recording';

type Preference = {
  height: ResolutionHeight;
  microphone: boolean;
  callAudio: boolean;
};

function loadPreference(): Preference {
  const fallback: Preference = {
    height: 1080,
    microphone: true,
    callAudio: true,
  };
  try {
    const saved = JSON.parse(localStorage.getItem(PREFERENCE_KEY) ?? 'null');
    if (RESOLUTIONS.some((item) => item.height === saved?.height))
      return { ...fallback, ...saved };
  } catch {
    // Storage can be unavailable; the defaults are fine.
  }
  return fallback;
}

function clock(ms: number) {
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const seconds = String(total % 60).padStart(2, '0');
  return hours ? `${hours}:${minutes}:${seconds}` : `${minutes}:${seconds}`;
}

/**
 * Records the lesson on this board — the canvas plus voices — and downloads
 * it when stopped. Nothing is uploaded.
 */
export function SessionRecorderControl({
  stageRef,
  title,
  hasCall,
  callStreams,
  callMicrophone,
  onNotice,
  locked = false,
  needsAccount = false,
  onLocked,
  onRecordingChange,
}: {
  stageRef: React.RefObject<SVGSVGElement | null>;
  title: string;
  /** Whether this board has a voice call to include. */
  hasCall: boolean;
  callStreams: () => MediaStream[];
  /** The microphone the call already has open, if this tab is in the call. */
  callMicrophone: () => MediaStream | null;
  onNotice: (message: string) => void;
  /** Recording is a Premium feature; locked opens the upgrade instead. */
  locked?: boolean;
  /** Signed out or a guest: the way in is an account, not a payment. */
  needsAccount?: boolean;
  onLocked?: () => void;
  /** Tells everyone on the board while this tab is recording. */
  onRecordingChange?: (recording: boolean) => void;
}) {
  const pathname = usePathname();
  const [accountPromptOpen, setAccountPromptOpen] = useState(false);
  const [unsupported, setUnsupported] = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [preference, setPreference] = useState<Preference>({
    height: 1080,
    microphone: true,
    callAudio: true,
  });
  const [status, setStatus] = useState<
    'idle' | 'starting' | 'recording' | 'paused' | 'saving'
  >('idle');
  const [elapsed, setElapsed] = useState(0);
  const recorderRef = useRef<SessionRecorder | null>(null);
  // Elapsed time excludes pauses.
  const timing = useRef({ total: 0, since: 0 });

  useEffect(() => {
    setUnsupported(recordingUnsupported());
    setPreference(loadPreference());
  }, []);

  const active = status === 'recording' || status === 'paused';

  // Nobody is recorded without knowing: the room is told as recording
  // starts, and again when it stops or this tab leaves.
  const reportRecording = useEffectEvent((recording: boolean) =>
    onRecordingChange?.(recording),
  );
  useEffect(() => {
    reportRecording(active);
  }, [active]);
  useEffect(() => () => reportRecording(false), []);

  // A plan that ends while the setup is open cannot start a recording.
  useEffect(() => {
    if (locked) setSetupOpen(false);
  }, [locked]);

  useEffect(() => {
    if (status !== 'recording') return;
    const tick = () =>
      setElapsed(timing.current.total + Date.now() - timing.current.since);
    tick();
    const timer = setInterval(tick, 500);
    return () => clearInterval(timer);
  }, [status]);

  // Leaving mid-lesson would lose the recording, so ask first.
  useEffect(() => {
    if (!active) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [active]);

  // Leaving the board inside the app still downloads what was captured.
  useEffect(() => () => void recorderRef.current?.stop(), []);

  async function start() {
    const stage = stageRef.current;
    // The button is the only way in, but never start for a locked plan.
    if (!stage || locked) return;
    try {
      localStorage.setItem(PREFERENCE_KEY, JSON.stringify(preference));
    } catch {
      // Not remembered; that is fine.
    }
    setSetupOpen(false);
    setStatus('starting');
    // The recorder is only downloaded once someone actually records.
    let SessionRecorderClass: typeof SessionRecorder;
    try {
      ({ SessionRecorder: SessionRecorderClass } =
        await import('../../lib/recorder'));
    } catch {
      setStatus('idle');
      onNotice('Recording could not start. Check your connection and retry.');
      return;
    }
    const recorder = new SessionRecorderClass(
      stage,
      { ...preference, callAudio: hasCall && preference.callAudio },
      title,
      callStreams,
      callMicrophone,
    );
    try {
      const note = await recorder.start();
      recorderRef.current = recorder;
      timing.current = { total: 0, since: Date.now() };
      setElapsed(0);
      setStatus('recording');
      onNotice(note || 'Recording started. The video downloads when you stop.');
    } catch (error) {
      console.warn('Recording failed to start', error);
      void recorder.stop();
      setStatus('idle');
      onNotice('Recording could not start in this browser.');
    }
  }

  function togglePause() {
    const recorder = recorderRef.current;
    if (!recorder) return;
    if (status === 'recording') {
      recorder.pause();
      timing.current.total += Date.now() - timing.current.since;
      setElapsed(timing.current.total);
      setStatus('paused');
    } else {
      recorder.resume();
      timing.current.since = Date.now();
      setStatus('recording');
    }
  }

  async function stop() {
    const recorder = recorderRef.current;
    if (!recorder) return;
    setStatus('saving');
    await recorder.stop();
    recorderRef.current = null;
    setStatus('idle');
    onNotice('Recording saved to your downloads.');
  }

  if (active || status === 'saving')
    return (
      <div
        className={`rec-pill ${status === 'paused' ? 'is-paused' : ''}`}
        role="group"
        aria-label="Recording"
      >
        <span className="rec-dot" aria-hidden="true" />
        <span className="rec-time" aria-live="off">
          {status === 'saving' ? 'Saving…' : clock(elapsed)}
        </span>
        <button
          className="icon-button small"
          onClick={togglePause}
          disabled={status === 'saving'}
          aria-label={
            status === 'paused' ? 'Resume recording' : 'Pause recording'
          }
          title={status === 'paused' ? 'Resume' : 'Pause'}
        >
          <Icon name={status === 'paused' ? 'play' : 'pause'} size={15} />
        </button>
        <button
          className="icon-button small rec-stop"
          onClick={() => void stop()}
          disabled={status === 'saving'}
          aria-label="Stop and download recording"
          title="Stop and download"
        >
          <Icon name="stop" size={15} />
        </button>
      </div>
    );

  return (
    <>
      <button
        className={`icon-button rec-button ${locked ? 'is-premium-locked' : ''}`}
        onClick={() => {
          if (locked)
            return needsAccount ? setAccountPromptOpen(true) : onLocked?.();
          setSetupOpen(true);
          // Fetch the recorder while the person picks a resolution.
          void import('../../lib/recorder').catch(() => undefined);
        }}
        disabled={Boolean(unsupported) || status === 'starting'}
        aria-label={
          locked ? 'Record this session (Premium)' : 'Record this session'
        }
        title={
          unsupported ??
          (locked ? 'Recording is a Premium feature' : 'Record this session')
        }
      >
        <Icon name="record" />
      </button>

      {accountPromptOpen &&
        createPortal(
          <Modal
            onClose={() => setAccountPromptOpen(false)}
            className="record-modal"
          >
            <p className="kicker">Premium feature</p>
            <h2>Recording is a Premium feature</h2>
            <p className="modal-copy">
              Create a free account to start your trial, then upgrade to Premium
              to record your lessons in up to 4K.
            </p>
            <div className="modal-actions">
              <button
                className="button ghost"
                onClick={() => setAccountPromptOpen(false)}
              >
                Not now
              </button>
              <Link
                className="button ghost"
                href={`/login?next=${encodeURIComponent(pathname)}`}
              >
                Sign in
              </Link>
              <Link
                className="button primary"
                href={`/signup?next=${encodeURIComponent(pathname)}`}
              >
                Create account
              </Link>
            </div>
          </Modal>,
          document.body,
        )}

      {setupOpen &&
        createPortal(
          <Modal onClose={() => setSetupOpen(false)} className="record-modal">
            <p className="kicker">Record a session</p>
            <h2>Record what you teach</h2>
            <p className="modal-copy">
              Captures this board as you see it — every stroke, page change, and
              zoom — with your voice. When you stop, the video downloads to this
              computer. Nothing is uploaded.
            </p>
            {hasCall && (
              <p className="record-consent" role="note">
                <Icon name="record" size={14} /> Everyone on this board sees a
                “recording” notice while you record. Let them know first, and
                ask before recording anyone’s voice.
              </p>
            )}
            <fieldset className="record-options">
              <legend>Which resolution do you want?</legend>
              <div className="record-resolutions">
                {RESOLUTIONS.map((item) => (
                  <label
                    key={item.height}
                    className={`record-resolution ${preference.height === item.height ? 'is-selected' : ''}`}
                  >
                    <input
                      type="radio"
                      name="resolution"
                      value={item.height}
                      checked={preference.height === item.height}
                      onChange={() =>
                        setPreference({ ...preference, height: item.height })
                      }
                    />
                    <strong>{item.label}</strong>
                    <span>{item.name}</span>
                    <small>
                      up to ~{Math.round((item.mbps * 60) / 8)} MB/min
                    </small>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="record-toggles">
              <label className="menu-row toggle-row">
                <Icon name="mic" />
                <span>Include my microphone</span>
                <input
                  type="checkbox"
                  checked={preference.microphone}
                  onChange={(event) =>
                    setPreference({
                      ...preference,
                      microphone: event.target.checked,
                    })
                  }
                />
              </label>
              {hasCall && (
                <label className="menu-row toggle-row">
                  <Icon name="users" />
                  <span>Include voices from the call</span>
                  <input
                    type="checkbox"
                    checked={preference.callAudio}
                    onChange={(event) =>
                      setPreference({
                        ...preference,
                        callAudio: event.target.checked,
                      })
                    }
                  />
                </label>
              )}
            </div>
            <p className="record-hint">
              Keep this tab open while recording. Most videos are far smaller
              than the estimate, since boards change slowly.
            </p>
            <div className="modal-actions">
              <button
                className="button ghost"
                onClick={() => setSetupOpen(false)}
              >
                Cancel
              </button>
              <button className="button primary" onClick={() => void start()}>
                <Icon name="record" size={16} /> Start recording
              </button>
            </div>
          </Modal>,
          document.body,
        )}
    </>
  );
}
