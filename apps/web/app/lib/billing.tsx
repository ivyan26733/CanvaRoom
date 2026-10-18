'use client';

import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import {
  createContext,
  useContext,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from 'react';
import { Icon } from '../components/icons';
import { PAYWALL_EVENT, send, type Board, type User } from './api';
import { useAuth } from './auth';

// The dialog and its checkout code load only when someone opens it.
const UpgradeDialog = dynamic(() => import('./upgrade-dialog'), {
  ssr: false,
});

export type PlanState =
  | { kind: 'trial'; secondsLeft: number }
  | { kind: 'premium'; until: string }
  | { kind: 'free' };

/** The trial: 30 minutes of active use, counted by the server. */
export const TRIAL_SECONDS = 30 * 60;
/** How often an open, visible page tells the server it is in use. */
const BEAT_EVERY_MS = 20_000;

/** Boards the trial includes, and people besides the owner on each. */
export const TRIAL_BOARDS = 2;
export const TRIAL_GUESTS = 2;

/** Where an account stands now; undefined for guests and signed-out visitors. */
export function planState(
  user: User | null | undefined,
  now = Date.now(),
): PlanState | undefined {
  const plan = user?.plan;
  if (!plan) return;
  if (plan.paidUntil && Date.parse(plan.paidUntil) > now)
    return { kind: 'premium', until: plan.paidUntil };
  if (plan.trialUsedSeconds < TRIAL_SECONDS)
    return {
      kind: 'trial',
      secondsLeft: TRIAL_SECONDS - plan.trialUsedSeconds,
    };
  return { kind: 'free' };
}

/**
 * The board owner's tier at `now`: once the tier the server reported runs
 * out, the board is on the free plan. Undefined for scratch boards.
 */
export function boardTier(board: Board | null | undefined, now = Date.now()) {
  const plan = board?.plan;
  if (!plan) return;
  return plan.until && Date.parse(plan.until) <= now ? 'free' : plan.tier;
}

/**
 * Export, images, and recording: open when the board's owner or the person
 * using them has Premium. Scratch boards keep everything.
 */
export function premiumUnlocked(
  board: Board | null | undefined,
  user: User | null | undefined,
  now = Date.now(),
) {
  if (board && !board.plan) return true;
  return (
    boardTier(board, now) === 'premium' ||
    planState(user, now)?.kind === 'premium'
  );
}

/** Re-renders every `ms` so countdowns and expiry stay current. */
export function useNow(ms = 15_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(timer);
  }, [ms]);
  return now;
}

/**
 * Opens the upgrade dialog from anywhere on the page, optionally saying what
 * the person just tried to do.
 */
export function openUpgrade(reason?: unknown) {
  // Used directly as a click handler too, when `reason` is the click event.
  window.dispatchEvent(
    new CustomEvent(PAYWALL_EVENT, {
      detail: typeof reason === 'string' ? reason : '',
    }),
  );
}

const daysLeft = (until: string, now: number) =>
  Math.max(1, Math.ceil((Date.parse(until) - now) / 86_400_000));

/** Premium months this close to their end show a renew prompt. */
export const RENEW_WITHIN_DAYS = 3;

export const longDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

/**
 * "Free trial · 23 min left", "Premium until 18 Nov", a renew prompt near the
 * end of a month, or an upgrade button on the free plan.
 */
export function PlanChip({ className = '' }: { className?: string }) {
  const { user } = useAuth();
  const now = useNow();
  const trial = useContext(TrialContext);
  const state = planState(user, now);
  if (!state) return null;
  if (
    state.kind === 'premium' &&
    Date.parse(state.until) - now > RENEW_WITHIN_DAYS * 86_400_000
  )
    return (
      <span className={`plan-chip is-pro ${className}`}>
        <Icon name="sparkle" size={14} /> Premium until {longDate(state.until)}
      </span>
    );
  return (
    <button
      type="button"
      className={`plan-chip ${state.kind === 'free' ? 'is-expired' : ''} ${state.kind === 'premium' ? 'is-pro' : ''} ${className}`}
      onClick={openUpgrade}
    >
      <Icon name="sparkle" size={14} />
      {state.kind === 'trial'
        ? `Free trial · ${Math.max(1, Math.ceil((trial.left ?? state.secondsLeft) / 60))} min left${trial.paused ? ' · paused' : ''}`
        : state.kind === 'premium'
          ? `Premium ends in ${daysLeft(state.until, now)} d · Renew`
          : 'Free plan · Upgrade'}
    </button>
  );
}

/** A small "Premium" tag beside features the free plans leave out. */
export function PremiumTag() {
  return (
    <span className="premium-tag" aria-label="Premium feature">
      Premium
    </span>
  );
}

/**
 * Listens for the paywall from anywhere on the page and shows the upgrade
 * dialog with Razorpay checkout.
 */
export function BillingProvider({ children }: { children: React.ReactNode }) {
  // The reason the dialog opened, or an empty string for a plain upgrade.
  const [reason, setReason] = useState<string | null>(null);
  const trial = useTrialClock();
  useEffect(() => {
    const show = (event: Event) =>
      setReason(((event as CustomEvent).detail as string | undefined) ?? '');
    window.addEventListener(PAYWALL_EVENT, show);
    return () => window.removeEventListener(PAYWALL_EVENT, show);
  }, []);
  return (
    <TrialContext.Provider value={trial}>
      {children}
      {reason !== null && (
        <UpgradeDialog reason={reason} onClose={() => setReason(null)} />
      )}
    </TrialContext.Provider>
  );
}

/** Trial seconds left on this page's clock, and whether it is paused. */
const TrialContext = createContext<{ left: number | null; paused: boolean }>({
  left: null,
  paused: false,
});

/** True while the page is visible and the browser is online. */
function useActive() {
  const [active, setActive] = useState(true);
  useEffect(() => {
    const update = () =>
      setActive(document.visibilityState === 'visible' && navigator.onLine);
    update();
    document.addEventListener('visibilitychange', update);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      document.removeEventListener('visibilitychange', update);
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return active;
}

/**
 * Counts down the trial while it is actually being used: the dashboard or a
 * board open in a visible tab, online. The page tells the server every 20
 * seconds; the server measures the time between those beats itself and
 * ignores long gaps, so hidden or offline time is never charged and a page
 * can't claim more than it was open. The countdown here is only a display
 * between beats.
 */
function useTrialClock() {
  const { user, setUser } = useAuth();
  const pathname = usePathname();
  const active = useActive();
  const inApp =
    pathname === '/' ||
    (pathname.startsWith('/board/') && !pathname.startsWith('/board/local-'));
  const state = planState(user);
  const onTrial = !user?.guest && state?.kind === 'trial';
  const counting = onTrial && active && inApp;
  const serverLeft = state?.kind === 'trial' ? state.secondsLeft : null;
  const [left, setLeft] = useState<number | null>(serverLeft);
  // A fresh figure from the server replaces the local estimate.
  const [shown, setShown] = useState(serverLeft);
  if (serverLeft !== shown) {
    setShown(serverLeft);
    setLeft(serverLeft);
  }
  const lastBeat = useRef(0);

  const beat = useEffectEvent(async () => {
    if (!user || !onTrial) return;
    lastBeat.current = Date.now();
    try {
      const result = await send<{ plan: User['plan'] | null }>(
        '/billing/heartbeat',
        'POST',
        {},
      );
      if (!result.plan) return;
      const next = { ...user, plan: result.plan };
      if (planState(next)?.kind !== 'trial') setUser(next);
      else setLeft(Math.max(0, TRIAL_SECONDS - result.plan.trialUsedSeconds));
    } catch {
      // Offline or rate-limited; the next beat catches up.
    }
  });

  useEffect(() => {
    if (!counting) return;
    // Starting (or coming back) beats at once, at most every few seconds.
    if (Date.now() - lastBeat.current > 5_000) void beat();
    const beats = window.setInterval(() => void beat(), BEAT_EVERY_MS);
    const ticks = window.setInterval(
      () =>
        setLeft((current) =>
          current === null ? current : Math.max(0, current - 1),
        ),
      1_000,
    );
    return () => {
      window.clearInterval(beats);
      window.clearInterval(ticks);
    };
  }, [counting]);

  // At zero the server decides; ask it now rather than at the next beat.
  const runOut = counting && left === 0;
  useEffect(() => {
    if (runOut) void beat();
  }, [runOut]);

  return { left: onTrial ? left : null, paused: onTrial && !counting };
}
