'use client';

import Link from 'next/link';
import { useAuth } from '../lib/auth';
import { openUpgrade, planState } from '../lib/billing';
import { DASHBOARD } from '../lib/next-url';

/**
 * The buttons under the price. Visitors start the trial; members see their
 * plan instead of sign-up buttons. The server render is the visitor version.
 */
export function PricingCta() {
  const { user } = useAuth();
  if (user && !user.guest) {
    const kind = planState(user)?.kind;
    if (kind === 'premium')
      return (
        <div className="pr-cta">
          <span className="button ghost is-static">You’re on Premium</span>
          <Link href={DASHBOARD} className="button primary">
            Open my boards
          </Link>
        </div>
      );
    return (
      <div className="pr-cta">
        <button className="button primary" onClick={() => openUpgrade()}>
          Upgrade to Premium
        </button>
        <Link href={DASHBOARD} className="button ghost">
          Open my boards
        </Link>
      </div>
    );
  }
  return (
    <div className="pr-cta">
      <Link href="/signup" className="button primary">
        Start the free trial
      </Link>
      <Link
        href={`/login?next=${encodeURIComponent(`${DASHBOARD}?upgrade=1`)}`}
        className="button ghost"
      >
        Upgrade to Premium
      </Link>
    </div>
  );
}

/** The story's closing call to action, for visitors or members. */
export function StoryCta() {
  const { user } = useAuth();
  if (user && !user.guest)
    return (
      <div className="st-finale-cta">
        <Link href={`${DASHBOARD}?new=1`} className="button primary">
          Start a new board
        </Link>
        <Link href={DASHBOARD} className="button ghost">
          Open my boards
        </Link>
      </div>
    );
  return (
    <div className="st-finale-cta">
      <Link href="/signup" className="button primary">
        Start a free board
      </Link>
      <a href="#get-started" className="button ghost">
        Sign in or try a scratch board
      </a>
    </div>
  );
}

/** The footer's account links: sign-up for visitors, the boards for members. */
export function FooterAccountLinks() {
  const { user } = useAuth();
  if (user && !user.guest)
    return (
      <>
        <li>
          <Link href={DASHBOARD}>My boards</Link>
        </li>
        <li>
          <Link href="/profile">Profile &amp; settings</Link>
        </li>
      </>
    );
  return (
    <>
      <li>
        <Link href="/signup">Create a free account</Link>
      </li>
      <li>
        <Link href="/login">Sign in</Link>
      </li>
    </>
  );
}
