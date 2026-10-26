'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { send } from '../lib/api';
import { useAuth } from '../lib/auth';
import { planState } from '../lib/billing';
import { BOARD_TIME_EVENT, type BoardTimeDetail } from '../lib/board-metrics';
import {
  FEATURE_CHIPS,
  PRAISE_CHIPS,
  PROBLEM_CHIPS,
  type Chip,
} from '../lib/feedback-chips';

/**
 * A small card that asks how CanvaRoom is working, once someone has spent a
 * while on boards. Mostly taps: a star rating, then one-tap answers (what got
 * in the way, or what works well, and what to add), with optional words.
 *
 * It waits for a calm moment: right after leaving a board, or on a board
 * after a minute without input. Never while recording, never on the admin
 * console, never for guests. After an answer it rests for 30 days; after
 * "Not now", 3 days. Add ?feedback=1 to any page to see it at once.
 */

const STORE_KEY = 'canvaroom.feedback-prompt';
/** Board time before the first ask, and between asks. */
const ASK_AFTER_MS = 10 * 60_000;
const IDLE_ON_BOARD_MS = 60_000;
const REST_AFTER_ANSWER_MS = 30 * 86_400_000;
const REST_AFTER_DISMISS_MS = 3 * 86_400_000;

type Saved = {
  /** Visible board time since the last ask. */
  boardMs: number;
  /** Not before this time (ms since 1970). */
  nextAt: number;
  /** How the most recent board minute ran, attached to the answer. */
  last?: BoardTimeDetail;
};

function readSaved(): Saved {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}');
    return {
      boardMs: Number(saved.boardMs) || 0,
      nextAt: Number(saved.nextAt) || 0,
      ...(saved.last ? { last: saved.last } : {}),
    };
  } catch {
    return { boardMs: 0, nextAt: 0 };
  }
}

function writeSaved(saved: Saved) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(saved));
  } catch {
    // Private browsing: the prompt may simply ask again another day.
  }
}

const due = (saved: Saved) =>
  saved.boardMs >= ASK_AFTER_MS && Date.now() >= saved.nextAt;

/** Something else is on screen, or this is no time to interrupt. */
const busy = () =>
  document.visibilityState !== 'visible' ||
  document.documentElement.dataset.recording === 'true' ||
  document.querySelector('.modal, [role="dialog"][aria-modal="true"]') !== null;

function device() {
  const ua = navigator.userAgent;
  return {
    mobile: /Mobi|Android|iPhone|iPad/.test(ua),
    os: /iPhone|iPad/.test(ua)
      ? 'iOS'
      : /Android/.test(ua)
        ? 'Android'
        : /Mac OS X/.test(ua)
          ? 'macOS'
          : /Windows/.test(ua)
            ? 'Windows'
            : 'Other',
    browser: /Edg\//.test(ua)
      ? 'Edge'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'Other',
  };
}

export function FeedbackPrompt() {
  const { user } = useAuth();
  const pathname = usePathname();
  const search = useSearchParams();
  const [open, setOpen] = useState(false);
  const wasOnBoard = useRef(false);
  const signedIn = Boolean(user && !user.guest);
  const allowedHere = !pathname.startsWith('/admin');

  // Count board time from the board's minute-by-minute reports.
  useEffect(() => {
    const onMinute = (event: Event) => {
      const detail = (event as CustomEvent<BoardTimeDetail>).detail;
      const saved = readSaved();
      writeSaved({
        ...saved,
        boardMs: saved.boardMs + detail.visibleMs,
        last: detail,
      });
    };
    window.addEventListener(BOARD_TIME_EVENT, onMinute);
    return () => window.removeEventListener(BOARD_TIME_EVENT, onMinute);
  }, []);

  // ?feedback=1 shows it straight away, for trying it out.
  useEffect(() => {
    if (signedIn && search.get('feedback') === '1') setOpen(true);
  }, [signedIn, search]);

  // Just left a board: a natural moment to ask.
  useEffect(() => {
    const onBoard = pathname.startsWith('/board/');
    const left = wasOnBoard.current && !onBoard;
    wasOnBoard.current = onBoard;
    if (!left || !signedIn || !allowedHere || !due(readSaved())) return;
    const timer = window.setTimeout(() => {
      if (!busy()) setOpen(true);
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [pathname, signedIn, allowedHere]);

  // On a board: ask only after a minute with no drawing or typing.
  useEffect(() => {
    if (!signedIn || !pathname.startsWith('/board/') || open) return;
    let lastInput = Date.now();
    const touched = () => {
      lastInput = Date.now();
    };
    const events = ['pointerdown', 'keydown', 'wheel'] as const;
    for (const name of events)
      window.addEventListener(name, touched, { passive: true });
    const timer = window.setInterval(() => {
      if (
        Date.now() - lastInput >= IDLE_ON_BOARD_MS &&
        due(readSaved()) &&
        !busy()
      )
        setOpen(true);
    }, 15_000);
    return () => {
      window.clearInterval(timer);
      for (const name of events) window.removeEventListener(name, touched);
    };
  }, [signedIn, pathname, open]);

  if (!open || !signedIn || !allowedHere) return null;
  return (
    <FeedbackCard
      onClose={(answered) => {
        writeSaved({
          boardMs: answered ? 0 : readSaved().boardMs,
          nextAt:
            Date.now() +
            (answered ? REST_AFTER_ANSWER_MS : REST_AFTER_DISMISS_MS),
        });
        setOpen(false);
      }}
      plan={planState(user)?.kind ?? 'none'}
    />
  );
}

function FeedbackCard({
  onClose,
  plan,
}: {
  onClose: (answered: boolean) => void;
  plan: string;
}) {
  const pathname = usePathname();
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [picked, setPicked] = useState<string[]>([]);
  const [features, setFeatures] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [busyState, setBusyState] = useState<'idle' | 'sending' | 'sent'>(
    'idle',
  );
  const [error, setError] = useState('');
  const happy = rating >= 4;
  const reasons = happy ? PRAISE_CHIPS : PROBLEM_CHIPS;

  // Once thanked, the card slips away by itself.
  useEffect(() => {
    if (busyState !== 'sent') return;
    const timer = window.setTimeout(() => onClose(true), 2200);
    return () => window.clearTimeout(timer);
  }, [busyState, onClose]);

  function toggle(list: string[], id: string) {
    return list.includes(id)
      ? list.filter((item) => item !== id)
      : [...list, id];
  }

  async function submit() {
    setBusyState('sending');
    setError('');
    const last = readSaved().last;
    try {
      await send('/feedback/quick', 'POST', {
        rating,
        tags: picked,
        features,
        ...(message.trim() ? { message: message.trim() } : {}),
        context: {
          page: pathname,
          plan,
          ...device(),
          ...(last
            ? {
                boardId: last.boardId,
                rttMedian: last.rttMedian,
                slowFrameMs: last.slowFrameMs,
                reconnects: last.reconnects,
              }
            : {}),
        },
      });
      setBusyState('sent');
    } catch (caught) {
      setError((caught as Error).message);
      setBusyState('idle');
    }
  }

  const chipRow = (
    chips: Chip[],
    chosen: string[],
    choose: (id: string) => void,
  ) => (
    <div className="fbp-chips">
      {chips.map((chip) => (
        <button
          key={chip.id}
          type="button"
          className={`fbp-chip ${chosen.includes(chip.id) ? 'is-on' : ''}`}
          aria-pressed={chosen.includes(chip.id)}
          onClick={() => choose(chip.id)}
        >
          <span aria-hidden="true">{chip.emoji}</span> {chip.label}
        </button>
      ))}
    </div>
  );

  return (
    <section
      className="fbp"
      role="dialog"
      aria-labelledby="fbp-title"
      aria-live="polite"
    >
      {busyState === 'sent' ? (
        <div className="fbp-thanks">
          <span aria-hidden="true">🙏</span>
          <strong>Thank you!</strong>
          <p>Every answer is read, and it shapes what we build next.</p>
        </div>
      ) : (
        <>
          <button
            className="fbp-close"
            aria-label="Not now"
            onClick={() => onClose(false)}
          >
            ×
          </button>
          <p className="fbp-kicker">Quick question · 10 seconds</p>
          <h2 id="fbp-title">How is CanvaRoom working for you?</h2>
          <div
            className="fbp-stars"
            role="radiogroup"
            aria-label="Rating"
            onMouseLeave={() => setHover(0)}
          >
            {[1, 2, 3, 4, 5].map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={rating === value}
                aria-label={`${value} star${value > 1 ? 's' : ''}`}
                className={(hover || rating) >= value ? 'is-on' : ''}
                onMouseEnter={() => setHover(value)}
                onClick={() => {
                  // Switching between happy and unhappy clears the old picks.
                  if (value >= 4 !== rating >= 4) setPicked([]);
                  setRating(value);
                }}
              >
                ★
              </button>
            ))}
          </div>
          {rating > 0 && (
            <div className="fbp-more">
              <p className="fbp-question">
                {happy ? 'What’s working well?' : 'What got in the way?'}
              </p>
              {chipRow(reasons, picked, (id) =>
                setPicked((current) => toggle(current, id)),
              )}
              <p className="fbp-question">Anything you’d like us to add?</p>
              {chipRow(FEATURE_CHIPS, features, (id) =>
                setFeatures((current) => toggle(current, id)),
              )}
              <textarea
                className="fbp-text"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                maxLength={1000}
                rows={2}
                placeholder="Anything else? (optional)"
              />
              {error && (
                <p className="fbp-error" role="alert">
                  {error}
                </p>
              )}
              <div className="fbp-actions">
                <button
                  type="button"
                  className="button ghost small"
                  onClick={() => onClose(false)}
                >
                  Not now
                </button>
                <button
                  type="button"
                  className="button primary small"
                  disabled={busyState === 'sending'}
                  onClick={() => void submit()}
                >
                  {busyState === 'sending' ? 'Sending…' : 'Send'}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
