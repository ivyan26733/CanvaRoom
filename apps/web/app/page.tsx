'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ThemeToggle } from './components/theme-toggle';
import { api, readSession, send, writeSession, type Session } from './lib/api';

type BoardListItem = {
  id: string;
  title: string;
  role: string;
  locked: boolean;
  updatedAt: string;
  objectCount: number;
};

export default function HomePage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [name, setName] = useState('');
  const [boards, setBoards] = useState<BoardListItem[]>([]);
  const [title, setTitle] = useState('Untitled board');
  const [showCreate, setShowCreate] = useState(false);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const saved = readSession();
    if (saved) {
      setSession(saved);
      setName(saved.user.name);
    }
  }, []);

  useEffect(() => {
    if (!session) return;
    api<BoardListItem[]>('/boards')
      .then(setBoards)
      .catch((error) => setNotice(error.message));
  }, [session]);

  async function enter(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice('');
    try {
      const result = await send<Session>('/session', 'POST', { name });
      writeSession(result);
      setSession(result);
      setName(result.user.name);
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function createBoard(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const board = await send<{ id: string }>('/boards', 'POST', { title });
      router.push(`/board/${board.id}`);
    } catch (error) {
      setNotice((error as Error).message);
      setBusy(false);
    }
  }

  function createLocalBoard() {
    router.push(`/board/local-${crypto.randomUUID()}`);
  }

  async function joinBoard(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const data = new FormData(event.currentTarget);
    const invite = String(data.get('invite') ?? '').trim();
    const match =
      invite.match(/\/board\/([^/?]+).*?[?&]invite=([^&]+)/) ??
      invite.match(/^([^:]+):(.+)$/);
    if (!match) {
      setNotice('Paste a complete board invite link.');
      setBusy(false);
      return;
    }
    const [, boardId, inviteToken] = match;
    try {
      await send(`/boards/${boardId}/join`, 'POST', {
        inviteToken: decodeURIComponent(inviteToken!),
      });
      router.push(`/board/${boardId}`);
    } catch (error) {
      setNotice((error as Error).message);
      setBusy(false);
    }
  }

  async function duplicateBoard(boardId: string) {
    try {
      const copy = await send<{ id: string }>(
        `/boards/${boardId}/duplicate`,
        'POST',
        {},
      );
      router.push(`/board/${copy.id}`);
    } catch (error) {
      setNotice((error as Error).message);
    }
  }

  async function deleteBoard(boardId: string, boardTitle: string) {
    if (!window.confirm(`Delete “${boardTitle}”? This cannot be undone.`))
      return;
    try {
      await send(`/boards/${boardId}`, 'DELETE');
      setBoards((current) => current.filter((board) => board.id !== boardId));
    } catch (error) {
      setNotice((error as Error).message);
    }
  }

  return (
    <main className="home-shell">
      <header className="home-topbar">
        <Link className="brand" href="/">
          <span className="brand-mark">✳</span> CollabBoard
        </Link>
        <div className="home-tools">
          <ThemeToggle />
          {session && (
            <button
              className="user-pill"
              title="Switch temporary identity"
              onClick={() => {
                localStorage.removeItem('collabboard.session');
                setSession(null);
              }}
            >
              <span className="avatar tiny">
                {session.user.name[0]?.toUpperCase()}
              </span>
              {session.user.name}
            </button>
          )}
        </div>
      </header>
      {!session ? (
        <section className="welcome-panel">
          <div className="welcome-art" aria-hidden="true">
            <div className="art-card art-card-one">🌱</div>
            <div className="art-card art-card-two">A + B = ?</div>
            <div className="art-card art-card-three">✎</div>
            <span className="art-spark">✳</span>
          </div>
          <p className="eyebrow">A SPACE TO THINK TOGETHER</p>
          <h1>
            Big ideas start
            <br />
            with a blank board.
          </h1>
          <p className="subhead">
            Draw it out, work it through, and make something together.
          </p>
          <form className="join-form" onSubmit={enter}>
            <label htmlFor="display-name">What should we call you?</label>
            <div className="join-input-row">
              <input
                id="display-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Your name"
                maxLength={48}
                required
                autoFocus
              />
              <button className="button primary" disabled={busy}>
                Let’s go <span aria-hidden="true">→</span>
              </button>
            </div>
          </form>
          <button
            className="button subtle local-board-button"
            onClick={createLocalBoard}
          >
            Open a local board
          </button>
          {notice && <p className="notice error">{notice}</p>}
          <p className="small-note">
            This local prototype uses a temporary name-only session.
          </p>
        </section>
      ) : (
        <section className="dashboard">
          <div className="dashboard-heading">
            <div>
              <p className="eyebrow">YOUR WORKSPACE</p>
              <h1>Good ideas, in progress.</h1>
              <p className="subhead">
                Pick up where you left off or start with a fresh board.
              </p>
            </div>
            <button
              className="button primary create-button"
              onClick={() => setShowCreate(true)}
            >
              ＋ New board
            </button>
            <button className="button subtle" onClick={createLocalBoard}>
              Open local board
            </button>
          </div>
          <form className="invite-join" onSubmit={joinBoard}>
            <span className="invite-icon">↗</span>
            <input
              name="invite"
              placeholder="Paste a board invite link to join"
              aria-label="Board invite link"
            />
            <button className="button subtle" disabled={busy}>
              Join board
            </button>
          </form>
          {notice && <p className="notice error">{notice}</p>}
          <div className="section-title">
            <h2>Recent boards</h2>
            <span>
              {boards.length} {boards.length === 1 ? 'board' : 'boards'}
            </span>
          </div>
          {boards.length ? (
            <div className="board-grid">
              {boards.map((board, index) => (
                <article
                  className={`board-card board-card-${index % 4}`}
                  key={board.id}
                >
                  <Link href={`/board/${board.id}`} className="board-card-link">
                    <div className="board-preview">
                      <span className="preview-grid" />
                      <span className="preview-stroke stroke-a" />
                      <span className="preview-stroke stroke-b" />
                      <span className="preview-note">
                        {
                          [
                            'let it grow',
                            'what if?',
                            'ideas live here',
                            'plan / make / share',
                          ][index % 4]
                        }
                      </span>
                      <span className="preview-dot">✳</span>
                    </div>
                    <div className="board-card-copy">
                      <div>
                        <h3>{board.title}</h3>
                        <p>
                          {board.objectCount}{' '}
                          {board.objectCount === 1 ? 'item' : 'items'} ·{' '}
                          {new Date(board.updatedAt).toLocaleDateString()}
                        </p>
                      </div>
                      <span className="role-badge">{board.role}</span>
                    </div>
                  </Link>
                  <div className="board-card-actions">
                    <button
                      title="Duplicate board"
                      aria-label={`Duplicate ${board.title}`}
                      onClick={() => void duplicateBoard(board.id)}
                    >
                      ⧉
                    </button>
                    {board.role === 'owner' && (
                      <button
                        title="Delete board"
                        aria-label={`Delete ${board.title}`}
                        onClick={() => void deleteBoard(board.id, board.title)}
                      >
                        ⌫
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-boards">
              <span>✳</span>
              <h3>Your next great idea starts here.</h3>
              <p>Create a board or join one with an invite link.</p>
              <button
                className="button primary"
                onClick={() => setShowCreate(true)}
              >
                Create your first board
              </button>
            </div>
          )}
        </section>
      )}
      {showCreate && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShowCreate(false);
          }}
        >
          <form className="modal" onSubmit={createBoard}>
            <button
              type="button"
              className="modal-close"
              aria-label="Close"
              onClick={() => setShowCreate(false)}
            >
              ×
            </button>
            <p className="eyebrow">NEW CANVAS</p>
            <h2>What are we working on?</h2>
            <label htmlFor="board-title">Give your board a name</label>
            <input
              id="board-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={80}
              autoFocus
              required
            />
            <div className="modal-actions">
              <button
                type="button"
                className="button subtle"
                onClick={() => setShowCreate(false)}
              >
                Cancel
              </button>
              <button className="button primary" disabled={busy}>
                Create board <span aria-hidden="true">→</span>
              </button>
            </div>
          </form>
        </div>
      )}
      <footer className="home-footer">
        <span>Made for thinking out loud.</span>
        <span>CollabBoard · collaborative whiteboard</span>
      </footer>
    </main>
  );
}
