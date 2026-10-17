'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AppShell,
  swatchFor,
  timeAgo,
  type DashboardView,
} from './components/app-shell';
import { AuthForm } from './components/auth-form';
import { BoardPreview } from './components/board-preview';
import { Icon, Logo } from './components/icons';
import {
  TemplateArt,
  TEMPLATES,
  type TemplateId,
} from './components/templates';
import { ThemeToggle } from './components/theme-toggle';
import { Modal } from './components/modal';
import { useDismiss } from './components/user-menu';
import { api, send, type ApiError, type BoardListItem } from './lib/api';
import { useAuth } from './lib/auth';
import { openUpgrade, planState, TRIAL_BOARDS, useNow } from './lib/billing';
import { BOARD_NAV } from './lib/navigation';

type Sort = 'recent' | 'name';

/**
 * Without a session cookie the visitor is signed out, so the landing page is
 * rendered on the server straight away (which is also what search engines
 * see). With one, wait to learn who they are before showing their boards.
 */
export function HomeClient({
  hasSession,
  children,
}: {
  hasSession: boolean;
  /** Server-rendered detail shown below the landing screen. */
  children: React.ReactNode;
}) {
  const { user } = useAuth();
  if (user) return <Dashboard />;
  if (user === undefined && hasSession)
    return (
      <main className="page-loading">
        <span className="loader" />
      </main>
    );
  return (
    <>
      <Landing />
      {children}
    </>
  );
}

// ---- Signed out ----

function Landing() {
  const router = useRouter();
  // Read from the router, not on mount, so links to `/?mode=signup` from this
  // same page (such as the footer) still switch to the sign-up form.
  const mode = useSearchParams().get('mode') === 'signup' ? 'signup' : 'login';
  const auth = useRef<HTMLElement>(null);

  useEffect(() => {
    if (mode === 'signup' && window.scrollY > 0)
      auth.current?.scrollIntoView({ block: 'start' });
  }, [mode]);

  return (
    <main className="landing">
      <section className="landing-stage">
        <header className="landing-brand">
          <Logo size={30} />
          <span>CanvaRoom</span>
        </header>
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

      <section className="landing-auth" id="get-started" ref={auth}>
        <div className="landing-auth-top">
          <span className="landing-mobile-brand">
            <Logo size={26} /> CanvaRoom
          </span>
          <ThemeToggle />
        </div>
        <div className="auth-panel">
          <h2>{mode === 'signup' ? 'Create your studio' : 'Welcome back'}</h2>
          <p className="auth-lede">
            {mode === 'signup'
              ? 'Free for 30 minutes, then a free plan. No card needed.'
              : 'Sign in to pick up where your team left off.'}
          </p>
          <AuthForm key={mode} initialMode={mode} />
          <div className="auth-or">
            <span>or</span>
          </div>
          <button
            className="button ghost wide"
            onClick={() =>
              router.push(`/board/local-${crypto.randomUUID()}`, BOARD_NAV)
            }
          >
            <Icon name="pen" size={17} />
            Open a scratch board — no account
          </button>
        </div>
        <p className="landing-foot">
          Scratch boards live only in your browser tab. Sign in to save and
          share.
        </p>
      </section>
    </main>
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

// ---- Signed in ----

function Dashboard() {
  const router = useRouter();
  const { user } = useAuth();
  const [boards, setBoards] = useState<BoardListItem[] | null>(null);
  const [view, setView] = useState<DashboardView>('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('recent');
  const [layout, setLayout] = useState<'grid' | 'list'>('grid');
  const [creating, setCreating] = useState<TemplateId | null>(null);
  const [joining, setJoining] = useState(false);
  const [upgrade, setUpgrade] = useState(false);
  const [notice, setNotice] = useState('');
  // Re-renders as the trial runs out, so the upgrade prompt appears on time.
  const now = useNow();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const requested = params.get('view');
    if (requested === 'mine' || requested === 'shared') setView(requested);
    if (params.get('mode') === 'signup') setUpgrade(true);
    // "Upgrade to Premium" on the pricing section links here.
    if (params.get('upgrade')) openUpgrade();
    try {
      const saved = localStorage.getItem('canvasroom.layout');
      if (saved === 'list' || saved === 'grid') setLayout(saved);
    } catch {
      // Defaults are fine.
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    api<BoardListItem[]>('/boards')
      .then(setBoards)
      .catch((error) => setNotice((error as Error).message));
  }, [user]);

  const shown = useMemo(() => {
    if (!boards) return null;
    const needle = query.trim().toLowerCase();
    return boards
      .filter((board) =>
        view === 'mine'
          ? board.role === 'owner'
          : view === 'shared'
            ? board.role !== 'owner'
            : true,
      )
      .filter((board) => !needle || board.title.toLowerCase().includes(needle))
      .sort((a, b) =>
        sort === 'name'
          ? a.title.localeCompare(b.title)
          : b.updatedAt.localeCompare(a.updatedAt),
      );
  }, [boards, view, query, sort]);

  if (!user) return null;

  function chooseView(next: DashboardView) {
    setView(next);
    window.history.replaceState(
      null,
      '',
      next === 'all' ? '/' : `/?view=${next}`,
    );
  }

  function startBoard(template: TemplateId = 'blank') {
    if (user?.guest) return setUpgrade(true);
    // The trial includes two boards and the free plan one; the server checks
    // too, this just saves filling in a name first.
    const owned = boards?.filter((board) => board.role === 'owner').length;
    const kind = planState(user)?.kind;
    if (owned !== undefined && kind === 'trial' && owned >= TRIAL_BOARDS)
      return openUpgrade(
        `The free trial includes ${TRIAL_BOARDS} boards. Upgrade to Premium for unlimited boards.`,
      );
    if (owned !== undefined && kind === 'free' && owned >= 1)
      return openUpgrade(
        'Your free trial has ended, and the free plan keeps one board. Upgrade to Premium for unlimited boards.',
      );
    setCreating(template);
  }

  function changeLayout(next: 'grid' | 'list') {
    setLayout(next);
    try {
      localStorage.setItem('canvasroom.layout', next);
    } catch {
      // Not remembered, still applied.
    }
  }

  async function duplicateBoard(boardId: string) {
    try {
      const copy = await send<{ id: string }>(
        `/boards/${boardId}/duplicate`,
        'POST',
        {},
      );
      router.push(`/board/${copy.id}`, BOARD_NAV);
    } catch (error) {
      if ((error as ApiError).code !== 'payment_required')
        setNotice((error as Error).message);
    }
  }

  async function deleteBoard(board: BoardListItem) {
    if (!window.confirm(`Delete “${board.title}”? This cannot be undone.`))
      return;
    try {
      await send(`/boards/${board.id}`, 'DELETE');
      setBoards(
        (current) => current?.filter((item) => item.id !== board.id) ?? null,
      );
    } catch (error) {
      setNotice((error as Error).message);
    }
  }

  const owned = boards?.filter((board) => board.role === 'owner').length ?? 0;
  const firstName = user.name.split(' ')[0];
  const heading =
    view === 'mine'
      ? 'Created by me'
      : view === 'shared'
        ? 'Shared with me'
        : 'All boards';

  return (
    <AppShell
      active={view}
      onView={chooseView}
      onNewBoard={() => startBoard()}
      onUpgrade={() => setUpgrade(true)}
      recent={boards ?? undefined}
      counts={
        boards
          ? {
              all: boards.length,
              mine: owned,
              shared: boards.length - owned,
            }
          : undefined
      }
    >
      <header className="main-header">
        <div className="search-field">
          <Icon name="search" size={17} />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search boards"
            aria-label="Search boards"
          />
        </div>
        <div className="main-header-actions">
          <button className="button ghost" onClick={() => setJoining(true)}>
            <Icon name="link" size={17} />
            Join with link
          </button>
          <button className="button primary" onClick={() => startBoard()}>
            <Icon name="plus" size={17} strokeWidth={2.2} />
            New board
          </button>
        </div>
      </header>

      <div className="main-body">
        <section className="welcome-row">
          <div>
            <p className="kicker">
              {new Date().toLocaleDateString([], {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
              })}
            </p>
            <h1>
              {greeting()}, {firstName}.
            </h1>
          </div>
          {user.guest && (
            <div className="guest-callout">
              <Icon name="sparkle" />
              <p>
                <strong>You’re on a guest pass.</strong> Boards you joined stay
                with you when you create an account.
              </p>
              <button
                className="button primary small"
                onClick={() => setUpgrade(true)}
              >
                Create account
              </button>
            </div>
          )}
          {planState(user, now)?.kind === 'free' && (
            <div className="guest-callout trial-callout">
              <Icon name="sparkle" />
              <p>
                <strong>Your free trial has ended.</strong> You’re on the free
                plan: your first board stays yours to use on your own, and the
                rest open view-only. Upgrade to Premium to collaborate, export,
                and add more boards.
              </p>
              <button className="button primary small" onClick={openUpgrade}>
                Upgrade
              </button>
            </div>
          )}
        </section>

        <section className="templates-row" aria-label="Start from a template">
          {TEMPLATES.map((template) => (
            <button
              key={template.id}
              className="template-tile"
              onClick={() => startBoard(template.id)}
            >
              <span className="template-art">
                <TemplateArt id={template.id} />
              </span>
              <span className="template-copy">
                <strong>{template.name}</strong>
                <small>{template.blurb}</small>
              </span>
            </button>
          ))}
        </section>

        {notice && (
          <p className="notice error" role="alert">
            {notice}
            <button aria-label="Dismiss" onClick={() => setNotice('')}>
              <Icon name="close" size={15} />
            </button>
          </p>
        )}

        <section className="boards-section">
          <div className="section-bar">
            <h2>
              {heading}
              {shown && <span className="section-count">{shown.length}</span>}
            </h2>
            <div className="section-tools">
              <label className="select-field">
                <span className="visually-hidden">Sort boards</span>
                <select
                  value={sort}
                  onChange={(event) => setSort(event.target.value as Sort)}
                >
                  <option value="recent">Last edited</option>
                  <option value="name">Name A–Z</option>
                </select>
                <Icon name="chevronDown" size={15} />
              </label>
              <div className="segmented" role="group" aria-label="Layout">
                <button
                  aria-pressed={layout === 'grid'}
                  aria-label="Grid view"
                  onClick={() => changeLayout('grid')}
                >
                  <Icon name="grid" size={16} />
                </button>
                <button
                  aria-pressed={layout === 'list'}
                  aria-label="List view"
                  onClick={() => changeLayout('list')}
                >
                  <Icon name="list" size={16} />
                </button>
              </div>
            </div>
          </div>

          {shown === null ? (
            <div className={`board-${layout}`}>
              {Array.from({ length: 4 }, (_, index) => (
                <div key={index} className="board-card skeleton" />
              ))}
            </div>
          ) : shown.length ? (
            <div className={`board-${layout}`}>
              {shown.map((board) => (
                <BoardCard
                  key={board.id}
                  board={board}
                  canDuplicate={!user.guest}
                  onDuplicate={() => void duplicateBoard(board.id)}
                  onDelete={() => void deleteBoard(board)}
                />
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <div className="empty-art">
                <TemplateArt id="blank" />
              </div>
              <h3>
                {query
                  ? `Nothing matches “${query}”.`
                  : view === 'shared'
                    ? 'No one has shared a board with you yet.'
                    : 'Your first board is one click away.'}
              </h3>
              <p>
                {query
                  ? 'Try another name.'
                  : 'Create a board, or paste an invite link someone sent you.'}
              </p>
              {!query && (
                <div className="empty-actions">
                  <button
                    className="button primary"
                    onClick={() => startBoard()}
                  >
                    New board
                  </button>
                  <button
                    className="button ghost"
                    onClick={() => setJoining(true)}
                  >
                    Join with link
                  </button>
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      {creating && (
        <CreateBoardModal
          initialTemplate={creating}
          onClose={() => setCreating(null)}
          onCreated={(id) => router.push(`/board/${id}`, BOARD_NAV)}
        />
      )}
      {joining && <JoinModal onClose={() => setJoining(false)} />}
      {upgrade && user.guest && (
        <Modal onClose={() => setUpgrade(false)}>
          <p className="kicker">Keep your work</p>
          <h2>Create your account</h2>
          <p className="modal-copy">
            Boards you joined as a guest move to your new profile.
          </p>
          <AuthForm initialMode="signup" onDone={() => setUpgrade(false)} />
        </Modal>
      )}
    </AppShell>
  );
}

function greeting() {
  const hour = new Date().getHours();
  return hour < 5
    ? 'Working late'
    : hour < 12
      ? 'Good morning'
      : hour < 18
        ? 'Good afternoon'
        : 'Good evening';
}

function BoardCard({
  board,
  canDuplicate,
  onDuplicate,
  onDelete,
}: {
  board: BoardListItem;
  canDuplicate: boolean;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(menu, setMenu, ref);
  return (
    <article className="board-card">
      <Link
        href={`/board/${board.id}`}
        className="board-card-link"
        transitionTypes={BOARD_NAV.transitionTypes}
      >
        <BoardPreview boardId={board.id} updatedAt={board.updatedAt} />
        <div className="board-card-copy">
          <span
            className="board-swatch"
            style={{ background: swatchFor(board.id) }}
          />
          <div>
            <h3>{board.title}</h3>
            <p>
              Edited {timeAgo(board.updatedAt)} · {board.objectCount}{' '}
              {board.objectCount === 1 ? 'item' : 'items'}
            </p>
          </div>
          <span className={`role-chip role-${board.role}`}>
            {board.locked && <Icon name="lock" size={12} />}
            {board.role === 'owner'
              ? 'Owner'
              : board.role === 'editor'
                ? 'Editor'
                : 'Viewer'}
          </span>
        </div>
      </Link>
      {(canDuplicate || board.role === 'owner') && (
        <div className="board-card-menu" ref={ref}>
          <button
            className="icon-button"
            aria-label={`More actions for ${board.title}`}
            aria-expanded={menu}
            onClick={() => setMenu((open) => !open)}
          >
            <Icon name="more" />
          </button>
          {menu && (
            <div className="popover" role="menu">
              {canDuplicate && board.role !== 'viewer' && (
                <button
                  className="menu-row"
                  role="menuitem"
                  onClick={() => {
                    setMenu(false);
                    onDuplicate();
                  }}
                >
                  <Icon name="copy" />
                  <span>Duplicate</span>
                </button>
              )}
              {board.role === 'owner' && (
                <button
                  className="menu-row danger"
                  role="menuitem"
                  onClick={() => {
                    setMenu(false);
                    onDelete();
                  }}
                >
                  <Icon name="trash" />
                  <span>Delete board</span>
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function CreateBoardModal({
  initialTemplate,
  onClose,
  onCreated,
}: {
  initialTemplate: TemplateId;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [template, setTemplate] = useState(initialTemplate);
  const defaultTitle = (id: TemplateId) =>
    id === 'blank'
      ? 'Untitled board'
      : TEMPLATES.find((item) => item.id === id)!.name;
  const [title, setTitle] = useState(defaultTitle(initialTemplate));
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const board = await send<{ id: string }>('/boards', 'POST', {
        title,
        template,
      });
      onCreated(board.id);
    } catch (caught) {
      // The upgrade dialog has opened over this one.
      if ((caught as ApiError).code === 'payment_required') return onClose();
      setError((caught as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} className="create-modal">
      <form onSubmit={create}>
        <p className="kicker">New board</p>
        <h2>What are we making?</h2>
        <div
          className="template-picker"
          role="radiogroup"
          aria-label="Template"
        >
          {TEMPLATES.map((item) => (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={template === item.id}
              className={template === item.id ? 'is-active' : ''}
              onClick={() => {
                setTemplate(item.id);
                if (!touched) setTitle(defaultTitle(item.id));
              }}
            >
              <span className="template-art">
                <TemplateArt id={item.id} />
              </span>
              <span>{item.name}</span>
            </button>
          ))}
        </div>
        <label className="field">
          <span>Board name</span>
          <input
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              setTouched(true);
            }}
            onFocus={(event) => event.currentTarget.select()}
            maxLength={80}
            autoFocus
            required
          />
        </label>
        {error && <p className="notice error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="button ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={busy || !title.trim()}>
            {busy ? 'Creating…' : 'Create board'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function JoinModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [link, setLink] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function join(event: React.FormEvent) {
    event.preventDefault();
    const match = link
      .trim()
      .match(/\/board\/([^/?#]+)\?(?:.*&)?invite=([^&#]+)/);
    if (!match) {
      setError('Paste the complete invite link, including “?invite=”.');
      return;
    }
    setBusy(true);
    try {
      await send(`/boards/${match[1]}/join`, 'POST', {
        inviteToken: decodeURIComponent(match[2]!),
      });
      router.push(`/board/${match[1]}`, BOARD_NAV);
    } catch (caught) {
      setError((caught as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose}>
      <form onSubmit={join}>
        <p className="kicker">Join a board</p>
        <h2>Paste your invite link</h2>
        <label className="field">
          <span>Invite link</span>
          <input
            value={link}
            onChange={(event) => setLink(event.target.value)}
            placeholder="https://…/board/…?invite=…"
            autoFocus
          />
        </label>
        {error && <p className="notice error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="button ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={busy || !link.trim()}>
            Join board
          </button>
        </div>
      </form>
    </Modal>
  );
}
