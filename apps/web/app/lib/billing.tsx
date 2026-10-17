'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { Icon } from '../components/icons';
import { PAYWALL_EVENT, type User } from './api';
import { useAuth } from './auth';

// The dialog and its checkout code load only when someone opens it.
const UpgradeDialog = dynamic(() => import('./upgrade-dialog'), {
  ssr: false,
});

export type PlanState =
  | { kind: 'trial'; until: string }
  | { kind: 'pro'; until: string }
  | { kind: 'expired' };

/** Where an account stands now; undefined for guests and signed-out visitors. */
export function planState(
  user: User | null | undefined,
  now = Date.now(),
): PlanState | undefined {
  const plan = user?.plan;
  if (!plan) return;
  if (plan.paidUntil && Date.parse(plan.paidUntil) > now)
    return { kind: 'pro', until: plan.paidUntil };
  if (Date.parse(plan.trialEndsAt) > now)
    return { kind: 'trial', until: plan.trialEndsAt };
  return { kind: 'expired' };
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

/** Opens the upgrade dialog from anywhere on the page. */
export function openUpgrade() {
  window.dispatchEvent(new CustomEvent(PAYWALL_EVENT));
}

const minutesLeft = (until: string, now: number) =>
  Math.max(1, Math.ceil((Date.parse(until) - now) / 60_000));

export const longDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

/** "Free trial · 23 min left", "Pro until 18 Nov", or an upgrade button. */
export function PlanChip({ className = '' }: { className?: string }) {
  const { user } = useAuth();
  const now = useNow();
  const state = planState(user, now);
  if (!state) return null;
  if (state.kind === 'pro')
    return (
      <span className={`plan-chip is-pro ${className}`}>
        <Icon name="sparkle" size={14} /> Pro until {longDate(state.until)}
      </span>
    );
  return (
    <button
      type="button"
      className={`plan-chip ${state.kind === 'expired' ? 'is-expired' : ''} ${className}`}
      onClick={openUpgrade}
    >
      <Icon name="sparkle" size={14} />
      {state.kind === 'trial'
        ? `Free trial · ${minutesLeft(state.until, now)} min left`
        : 'Trial ended · Upgrade'}
    </button>
  );
}

/**
 * Listens for the paywall from anywhere on the page and shows the upgrade
 * dialog with Razorpay checkout.
 */
export function BillingProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(PAYWALL_EVENT, show);
    return () => window.removeEventListener(PAYWALL_EVENT, show);
  }, []);
  return (
    <>
      {children}
      {open && <UpgradeDialog onClose={() => setOpen(false)} />}
    </>
  );
}
