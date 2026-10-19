import Link from 'next/link';
import { SiteHeader } from './site-header';
import './auth-screen.css';

export type AuthScene = 'signup' | 'login' | 'recover' | 'verify';

const COPY: Record<
  AuthScene,
  { kicker: string; title: React.ReactNode; points: string[] }
> = {
  signup: {
    kicker: 'New here',
    title: (
      <>
        Your first lesson,
        <br />
        <em>in 30 seconds.</em>
      </>
    ),
    points: [
      '30 minutes of free use, counted only while you’re on the board',
      'Ink shows up for everyone the moment you draw',
      'Voice, chat, and a QR invite built in',
    ],
  },
  login: {
    kicker: 'Welcome back',
    title: (
      <>
        Your board is
        <br />
        <em>right where you left it.</em>
      </>
    ),
    points: [
      'Every page, note, and stroke saved',
      'Students follow your pen, at your zoom',
      'Pick up the call where it ended',
    ],
  },
  recover: {
    kicker: 'Locked out',
    title: (
      <>
        Six digits
        <br />
        <em>and you’re back in.</em>
      </>
    ),
    points: [
      'We email a one-time code',
      'It works once, for 10 minutes',
      'Every other device is signed out',
    ],
  },
  verify: {
    kicker: 'Last step',
    title: (
      <>
        Check your inbox,
        <br />
        <em>then start drawing.</em>
      </>
    ),
    points: [
      'A 6-digit code is on its way',
      'It keeps receipts and recovery safe',
      'You can keep working while you wait',
    ],
  },
};

/** A full-screen sign-in page: a living board on one side, the form on the other. */
export function AuthScreen({
  scene,
  aside,
  children,
}: {
  scene: AuthScene;
  /** A small link in the top corner, such as "New here? Create an account". */
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  const copy = COPY[scene];
  return (
    <>
      <SiteHeader variant="compact" />
      <div className={`auth-page scene-${scene}`}>
        <section className="auth-art" aria-hidden="true">
          <div className="auth-art-board">
            <SceneArt scene={scene} />
          </div>
          <div className="auth-art-copy">
            <p className="auth-kicker">{copy.kicker}</p>
            <p className="auth-title">{copy.title}</p>
            <ul className="auth-points">
              {copy.points.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          </div>
        </section>
        <main className="auth-side">
          <header className="auth-side-top">
            <span />
            <div className="auth-side-actions">{aside}</div>
          </header>
          <div className="auth-side-body">{children}</div>
          <footer className="auth-side-foot">
            <Link href="/">Home</Link>
            <Link href="/about">About</Link>
            <Link href="/contact">Contact</Link>
          </footer>
        </main>
      </div>
    </>
  );
}

const CURSOR = 'M0 0L0 17L4.6 12.9L8 20.6L11.3 19.2L7.9 11.7L14 11.7Z';

function Cursor({
  className,
  color,
  name,
}: {
  className: string;
  color: string;
  name: string;
}) {
  const width = 16 + name.length * 7.4;
  return (
    <g className={`art-cursor ${className}`}>
      <path d={CURSOR} fill={color} stroke="#fff" strokeWidth="1.4" />
      <rect x="14" y="18" width={width} height="22" rx="11" fill={color} />
      <text x="24" y="33" className="art-name">
        {name}
      </text>
    </g>
  );
}

/** A small board that draws itself: different for each page. */
function SceneArt({ scene }: { scene: AuthScene }) {
  return (
    <svg viewBox="0 0 520 380" className="art-svg">
      <defs>
        <pattern
          id="art-dots"
          width="22"
          height="22"
          patternUnits="userSpaceOnUse"
        >
          <circle cx="1.5" cy="1.5" r="1.2" className="art-dot" />
        </pattern>
      </defs>
      <rect width="520" height="380" rx="18" className="art-paper" />
      <rect width="520" height="380" rx="18" fill="url(#art-dots)" />

      {scene === 'signup' && (
        <>
          <path className="art-ink art-ink-1" d="M90 300 L90 120 L300 300 Z" />
          <path className="art-ink art-ink-2 art-thin" d="M90 280 h20 v20" />
          <text x="60" y="214" className="art-hand art-pop art-pop-1">
            a
          </text>
          <text x="186" y="330" className="art-hand art-pop art-pop-2">
            b
          </text>
          <text x="206" y="196" className="art-hand art-pop art-pop-3">
            c
          </text>
          <text x="300" y="120" className="art-hand art-big art-pop art-pop-4">
            a² + b² = c²
          </text>
          <g className="art-note art-pop art-pop-5">
            <rect
              x="350"
              y="196"
              width="128"
              height="104"
              rx="6"
              fill="#ffe45c"
            />
            <text x="364" y="228" className="art-note-text">
              Homework
            </text>
            <text x="364" y="252" className="art-note-small">
              Q3 · Q5 · Q8
            </text>
          </g>
          <Cursor className="art-cursor-you" color="#ff4f1f" name="You" />
          <Cursor className="art-cursor-student" color="#2d5bff" name="Riya" />
          <g className="art-chip art-pop art-pop-6">
            <rect
              x="160"
              y="22"
              width="200"
              height="30"
              rx="15"
              className="art-chip-bg"
            />
            <circle cx="180" cy="37" r="5" fill="#ff4f1f" />
            <text x="194" y="42" className="art-chip-text">
              Riya is following you
            </text>
          </g>
        </>
      )}

      {scene === 'login' && (
        <>
          <g className="art-faded">
            <path
              className="art-ink-static"
              d="M70 290 C 120 200, 170 190, 210 250 S 300 320, 330 230"
            />
            <rect
              x="60"
              y="70"
              width="170"
              height="96"
              rx="12"
              className="art-box"
            />
            <text x="84" y="124" className="art-hand">
              Week 6 · Forces
            </text>
            <path
              className="art-ink-static art-thin"
              d="M240 118 C 290 118, 300 160, 350 170"
            />
          </g>
          <g className="art-note art-pop art-pop-1">
            <rect
              x="352"
              y="132"
              width="124"
              height="100"
              rx="6"
              fill="#a5c8ff"
            />
            <text x="366" y="164" className="art-note-text">
              F = m · a
            </text>
            <text x="366" y="188" className="art-note-small">
              recap first
            </text>
          </g>
          <path
            className="art-ink art-ink-1"
            d="M340 300 C 370 270, 410 262, 450 290"
          />
          <Cursor className="art-cursor-return" color="#ff4f1f" name="You" />
          <Cursor className="art-cursor-student" color="#12a150" name="Arjun" />
          <g className="art-card art-pop art-pop-2">
            <rect
              x="40"
              y="22"
              width="232"
              height="46"
              rx="12"
              className="art-chip-bg"
            />
            <rect x="52" y="32" width="26" height="26" rx="7" fill="#ff4f1f" />
            <text x="88" y="42" className="art-chip-text">
              Physics · Class 10
            </text>
            <text x="88" y="58" className="art-chip-small">
              Edited 2 hours ago · 3 pages
            </text>
          </g>
          <g className="art-bubble art-pop art-pop-3">
            <rect
              x="300"
              y="318"
              width="190"
              height="36"
              rx="18"
              className="art-chip-bg"
            />
            <text x="318" y="341" className="art-chip-text">
              Arjun: welcome back! 👋
            </text>
          </g>
        </>
      )}

      {(scene === 'recover' || scene === 'verify') && (
        <>
          <g className="art-envelope art-pop art-pop-1">
            <rect
              x="140"
              y="70"
              width="240"
              height="150"
              rx="14"
              className="art-box"
            />
            <path
              d="M144 78 L260 160 L376 78"
              className="art-ink-static art-thin"
            />
          </g>
          <g className="art-code">
            {[0, 1, 2, 3, 4, 5].map((index) => (
              <g
                key={index}
                className={`art-digit art-pop art-pop-${index + 2}`}
              >
                <rect
                  x={104 + index * 54}
                  y="250"
                  width="44"
                  height="56"
                  rx="10"
                  className="art-digit-box"
                />
                <text x={126 + index * 54} y="288" className="art-digit-text">
                  {scene === 'verify' ? '•' : '✱'}
                </text>
              </g>
            ))}
          </g>
          <path
            className="art-ink art-ink-1"
            d={
              scene === 'verify'
                ? 'M200 340 l18 18 l42 -42'
                : 'M190 344 C 230 330, 290 330, 330 350'
            }
          />
          <Cursor
            className="art-cursor-you"
            color="#ff4f1f"
            name={scene === 'verify' ? 'You' : 'Back soon'}
          />
        </>
      )}
    </svg>
  );
}
