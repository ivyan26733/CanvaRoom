'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Icon } from './components/icons';
import { SiteHeader } from './components/site-header';
import { useAuth } from './lib/auth';
import { planState } from './lib/billing';
import { BOARD_NAV } from './lib/navigation';
import { DASHBOARD } from './lib/next-url';

/**
 * The landing page, for everyone. It is rendered on the server (which is what
 * search engines see); signed-in visitors get "My boards" instead of the
 * sign-in buttons once the client knows who they are.
 */
export function HomeClient({
  hasSession,
  children,
}: {
  hasSession: boolean;
  /** Server-rendered detail shown below the landing screen. */
  children: React.ReactNode;
}) {
  return (
    <>
      <SiteHeader />
      <Landing hasSession={hasSession} />
      {children}
    </>
  );
}

function Landing({ hasSession }: { hasSession: boolean }) {
  return (
    <main className="landing">
      <section className="landing-stage">
        <LiveDemo />
        <div className="landing-copy">
          <p className="kicker">Online whiteboard · voice · chat</p>
          <h1>
            Think out loud,
            <br />
            <em>together.</em>
          </h1>
          <ul className="landing-points">
            <li>
              <strong>Every stroke, instantly.</strong> Ink streams to everyone
              as you draw — no waiting for you to lift the pen.
            </li>
            <li>
              <strong>Talk while you sketch.</strong> Built-in voice rooms and
              chat, one click away.
            </li>
            <li>
              <strong>Room to grow.</strong> Add pages, zoom from overview to
              detail, start from templates.
            </li>
          </ul>
        </div>
      </section>

      <section className="landing-auth" id="get-started">
        <StartPanel hasSession={hasSession} />
      </section>
    </main>
  );
}

/** The panel beside the hero: sign-up for visitors, the way back for members. */
function StartPanel({ hasSession }: { hasSession: boolean }) {
  const router = useRouter();
  const { user } = useAuth();
  const scratch = (
    <button
      className="button ghost wide"
      onClick={() =>
        router.push(`/board/local-${crypto.randomUUID()}`, BOARD_NAV)
      }
    >
      <Icon name="pen" size={17} />
      Open a scratch board — no account
    </button>
  );

  // Still learning who a returning visitor is: hold the space, don't flash.
  if (user === undefined && hasSession)
    return <div className="auth-panel landing-cta landing-cta-wait" />;

  if (user && !user.guest) {
    const plan = planState(user);
    return (
      <>
        <div className="auth-panel landing-cta">
          <p className="landing-cta-badge">
            {plan?.kind === 'premium'
              ? 'Premium'
              : plan?.kind === 'trial'
                ? 'Free trial'
                : 'Free plan'}
          </p>
          <h2>Welcome back, {user.name.split(' ')[0]}</h2>
          <p className="auth-lede">
            Your boards are where you left them. Pick one up, or start a fresh
            lesson.
          </p>
          <Link href={DASHBOARD} className="button primary wide auth-submit">
            Open my boards <span aria-hidden="true">→</span>
          </Link>
          <Link href={`${DASHBOARD}?new=1`} className="button ghost wide">
            <Icon name="plus" size={17} />
            New board
          </Link>
          <div className="auth-or">
            <span>or</span>
          </div>
          {scratch}
        </div>
        <p className="landing-foot">
          Scratch boards live only in this browser tab and aren’t saved.
        </p>
      </>
    );
  }

  return (
    <>
      <div className="auth-panel landing-cta">
        <p className="landing-cta-badge">Free trial · no card needed</p>
        <h2>Your first lesson in 30 seconds</h2>
        <p className="auth-lede">
          Make a board, share the link or QR code, and start drawing. 30 minutes
          of active use free, then a free plan.
        </p>
        <Link href="/signup" className="button primary wide auth-submit">
          Start free trial <span aria-hidden="true">→</span>
        </Link>
        <Link href="/login" className="button ghost wide">
          I already have an account
        </Link>
        <div className="auth-or">
          <span>or</span>
        </div>
        {scratch}
      </div>
      <p className="landing-foot">
        Scratch boards live only in your browser tab. Sign in to save and share.
      </p>
    </>
  );
}

/** A looping, self-drawing board that shows what live collaboration feels like. */
function LiveDemo() {
  return (
    <div className="live-demo" aria-hidden="true">
      <svg viewBox="70 40 700 420" preserveAspectRatio="xMidYMid meet">
        <g className="demo-note demo-note-a">
          <rect x="452" y="70" width="150" height="138" rx="6" fill="#ffe45c" />
          <text x="468" y="106">
            Launch plan
          </text>
          <text x="468" y="132" className="demo-small">
            ship on friday?
          </text>
        </g>
        <g className="demo-note demo-note-b">
          <rect
            x="612"
            y="136"
            width="132"
            height="122"
            rx="6"
            fill="#a5c8ff"
          />
          <text x="628" y="172">
            Interviews
          </text>
          <text x="628" y="196" className="demo-small">
            5 users booked
          </text>
        </g>
        <rect
          x="96"
          y="300"
          width="214"
          height="112"
          rx="10"
          className="demo-box"
        />
        <text x="126" y="364" className="demo-label">
          Research
        </text>
        <path d="M312 356 C 380 356, 400 250, 448 200" className="demo-arrow" />
        <path
          className="demo-ink"
          d="M108 150 C 150 92, 196 96, 214 140 S 286 196, 318 132 S 380 82, 404 118"
        />
        <path
          className="demo-ink demo-ink-2"
          d="M520 318 C 560 300, 610 300, 660 330 S 720 380, 700 420"
        />
        <g className="demo-cursor demo-cursor-a">
          <path
            d="M0 0L0 17L4.6 12.9L8 20.6L11.3 19.2L7.9 11.7L14 11.7Z"
            fill="#ff4f1f"
            stroke="#fff"
            strokeWidth="1.4"
          />
          <rect x="14" y="18" width="52" height="22" rx="11" fill="#ff4f1f" />
          <text x="26" y="33" className="demo-name">
            Maya
          </text>
        </g>
        <g className="demo-cursor demo-cursor-b">
          <path
            d="M0 0L0 17L4.6 12.9L8 20.6L11.3 19.2L7.9 11.7L14 11.7Z"
            fill="#2d5bff"
            stroke="#fff"
            strokeWidth="1.4"
          />
          <rect x="14" y="18" width="58" height="22" rx="11" fill="#2d5bff" />
          <text x="26" y="33" className="demo-name">
            Arjun
          </text>
        </g>
      </svg>
      <div className="demo-call">
        <span className="demo-avatar" style={{ background: '#ff4f1f' }}>
          M
        </span>
        <span
          className="demo-avatar speaking"
          style={{ background: '#2d5bff' }}
        >
          A
        </span>
        <span className="demo-avatar" style={{ background: '#12a150' }}>
          S
        </span>
        <span className="demo-call-label">
          <Icon name="mic" size={14} /> Voice · 3 here
        </span>
      </div>
      <div className="demo-chat">
        <strong>Sara</strong>
        <span>love this direction — adding notes on page 2</span>
      </div>
    </div>
  );
}
