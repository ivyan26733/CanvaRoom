'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AppShell,
  swatchFor,
  timeAgo,
  type DashboardView,
} from '../components/app-shell';
import { AuthForm } from '../components/auth-form';
import { BoardPreview } from '../components/board-preview';
import { Icon } from '../components/icons';
import { JoinBoardModal } from '../components/join-board';
import { Modal } from '../components/modal';
import {
  TemplateArt,
  TEMPLATES,
  type TemplateId,
} from '../components/templates';
import { useDismiss } from '../components/user-menu';
import { api, send, type ApiError, type BoardListItem } from '../lib/api';
import { useAuth } from '../lib/auth';
import { openUpgrade, planState, TRIAL_BOARDS, useNow } from '../lib/billing';
import { BOARD_NAV } from '../lib/navigation';
import { isPlanId } from '../lib/pricing';
import { DASHBOARD, NEW_BOARD_EVENT } from '../lib/next-url';

type Sort = 'recent' | 'name';

/** The signed-in home: boards, templates, and the plan. */
export function Dashboard() {
  const router = useRouter();
  const { user } = useAuth();

  // Signed out (or the session expired): sign in, then come back here.
  useEffect(() => {
    if (user === null)
      router.replace(
        `/login?next=${encodeURIComponent(DASHBOARD + location.search)}`,
      );
  }, [user, router]);

  if (!user)
    return (
      <main className="page-loading">
        <span className="loader" />
      </main>
    );
  return <Boards />;
}

function Boards() {
  const router = useRouter();
  const { user } = useAuth();
  const [boards, setBoards] = useState<BoardListItem[] | null>(null);
  const [view, setView] = useState<DashboardView>('all');
  const [sort, setSort] = useState<Sort>('recent');
  const [layout, setLayout] = useState<'grid' | 'list'>('grid');
  const [creating, setCreating] = useState<TemplateId | null>(null);
  const [joining, setJoining] = useState(false);
  const [upgrade, setUpgrade] = useState(false);
  const [notice, setNotice] = useState('');
  // "New board" from the header on another page lands here with ?new=1.
  const [pendingNew, setPendingNew] = useState(false);
  // Re-renders as the trial runs out, so the upgrade prompt appears on time.
  const now = useNow();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const requested = params.get('view');
    if (requested === 'mine' || requested === 'shared') setView(requested);
    if (params.get('mode') === 'signup') setUpgrade(true);
    // "Upgrade to Premium" on the pricing section links here: ?upgrade=yearly
    // opens checkout on that plan, ?upgrade=1 on the default one.
    const plan = params.get('upgrade');
    if (plan) openUpgrade('', isPlanId(plan) ? plan : undefined);
    if (params.get('new')) setPendingNew(true);
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

  // The header's "New board" button: on this page it asks directly, from
  // other pages it arrives as ?new=1. Either way the plan limits apply, so
  // it waits for the board list.
  useEffect(() => {
    const onNew = () => setPendingNew(true);
    window.addEventListener(NEW_BOARD_EVENT, onNew);
    return () => window.removeEventListener(NEW_BOARD_EVENT, onNew);
  }, []);
  useEffect(() => {
    if (!pendingNew || boards === null) return;
    setPendingNew(false);
    if (location.search.includes('new='))
      window.history.replaceState(null, '', location.pathname);
    startBoard();
    // startBoard reads this render's boards and plan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingNew, boards]);

  const shown = useMemo(() => {
    if (!boards) return null;
    return boards
      .filter((board) =>
        view === 'mine'
          ? board.role === 'owner'
          : view === 'shared'
            ? board.role !== 'owner'
            : true,
      )
      .sort((a, b) =>
        sort === 'name'
          ? a.title.localeCompare(b.title)
          : b.updatedAt.localeCompare(a.updatedAt),
      );
  }, [boards, view, sort]);

  if (!user) return null;

  function chooseView(next: DashboardView) {
    setView(next);
    window.history.replaceState(
      null,
      '',
      next === 'all' ? DASHBOARD : `${DASHBOARD}?view=${next}`,
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
                {view === 'shared'
                  ? 'No one has shared a board with you yet.'
                  : 'Your first board is one click away.'}
              </h3>
              <p>Create a board, or paste an invite link someone sent you.</p>
              {
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
              }
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
      {joining && <JoinBoardModal onClose={() => setJoining(false)} />}
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
