'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

/**
 * Microsoft Clarity (session recordings, heatmaps, rage and dead clicks) for
 * the site's pages: home, sign-up, dashboard, pricing and the upgrade dialog.
 * It never runs on boards, where recording every stroke would slow the board
 * down and capture people's work, nor on the admin console.
 *
 * Off until NEXT_PUBLIC_CLARITY_ID is set. Visitors from the EU, the UK and
 * Switzerland are asked first; everyone else is recorded with analytics
 * consent, never ads. Inputs are masked by Clarity's default settings.
 */

const PROJECT_ID = process.env.NEXT_PUBLIC_CLARITY_ID?.trim();
const CHOICE_KEY = 'canvaroom.analytics-consent';
/** Where Clarity's terms require consent before recording (EEA, UK, CH). */
const ASK_FIRST = new Set(
  'AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE IS LI NO GB CH'.split(
    ' ',
  ),
);

type ClarityFn = ((...args: unknown[]) => void) & { q?: unknown[][] };
declare global {
  interface Window {
    clarity?: ClarityFn;
  }
}

/** Pages Clarity must not record. */
const excluded = (path: string) =>
  path.startsWith('/board/') || path.startsWith('/admin');

function readChoice() {
  try {
    const value = localStorage.getItem(CHOICE_KEY);
    return value === 'granted' || value === 'denied' ? value : null;
  } catch {
    return null;
  }
}

function saveChoice(value: 'granted' | 'denied') {
  try {
    localStorage.setItem(CHOICE_KEY, value);
  } catch {
    // Private mode: ask again next visit.
  }
}

let loaded = false;
/** Adds Clarity's tag once, with analytics consent and no ad storage. */
function load(id: string) {
  if (loaded) return;
  loaded = true;
  const queue: ClarityFn = (...args: unknown[]) => {
    (queue.q ??= []).push(args);
  };
  window.clarity ??= queue;
  window.clarity('consentv2', {
    ad_Storage: 'denied',
    analytics_Storage: 'granted',
  });
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.clarity.ms/tag/${encodeURIComponent(id)}`;
  document.head.appendChild(script);
}

export function Clarity() {
  const pathname = usePathname();
  const [ask, setAsk] = useState(false);
  const [ready, setReady] = useState(false);

  // Decide once whether this visitor may be recorded.
  useEffect(() => {
    if (!PROJECT_ID) return;
    const choice = readChoice();
    if (choice) {
      setReady(choice === 'granted');
      return;
    }
    let cancelled = false;
    fetch('/api/geo', { credentials: 'same-origin' })
      .then((response) => (response.ok ? response.json() : { country: null }))
      .then(({ country }: { country: string | null }) => {
        if (cancelled) return;
        // Unknown country: ask, to be safe.
        if (!country || ASK_FIRST.has(country)) setAsk(true);
        else setReady(true);
      })
      .catch(() => !cancelled && setAsk(true));
    return () => {
      cancelled = true;
    };
  }, []);

  // Load on allowed pages; stop while on a board or the admin console.
  useEffect(() => {
    if (!PROJECT_ID || !ready) return;
    if (excluded(pathname)) {
      if (loaded) window.clarity?.('stop');
      return;
    }
    if (loaded) window.clarity?.('start');
    else load(PROJECT_ID);
  }, [ready, pathname]);

  if (!PROJECT_ID || !ask || excluded(pathname)) return null;
  return (
    <div className="consent-bar" role="dialog" aria-label="Analytics consent">
      <p>
        May we use Microsoft Clarity to see how people use this site, so we can
        fix what&rsquo;s confusing? It never records your boards, and typing is
        hidden.
      </p>
      <div>
        <button
          className="button ghost small"
          onClick={() => {
            saveChoice('denied');
            setAsk(false);
          }}
        >
          No thanks
        </button>
        <button
          className="button primary small"
          onClick={() => {
            saveChoice('granted');
            setAsk(false);
            setReady(true);
          }}
        >
          Allow
        </button>
      </div>
    </div>
  );
}
