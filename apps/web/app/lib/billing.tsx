'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { Icon } from '../components/icons';
import { PAYWALL_EVENT, type Board, type User } from './api';
import { useAuth } from './auth';

// The dialog and its checkout code load only when someone opens it.
const UpgradeDialog = dynamic(() => import('./upgrade-dialog'), {
  ssr: false,
});

export type PlanState =
  | { kind: 'trial'; until: string }
  | { kind: 'premium'; until: string }
  | { kind: 'free' };

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
  if (Date.parse(plan.trialEndsAt) > now)
    return { kind: 'trial', until: plan.trialEndsAt };
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

const minutesLeft = (until: string, now: number) =>
  Math.max(1, Math.ceil((Date.parse(until) - now) / 60_000));
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
        ? `Free trial · ${minutesLeft(state.until, now)} min left`
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
  useEffect(() => {
    const show = (event: Event) =>
      setReason(((event as CustomEvent).detail as string | undefined) ?? '');
    window.addEventListener(PAYWALL_EVENT, show);
    return () => window.removeEventListener(PAYWALL_EVENT, show);
  }, []);
  return (
    <>
      {children}
      {reason !== null && (
        <UpgradeDialog reason={reason} onClose={() => setReason(null)} />
      )}
    </>
  );
}
