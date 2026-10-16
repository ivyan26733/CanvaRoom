'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AppShell } from '../components/app-shell';
import { Icon } from '../components/icons';
import { Avatar } from '../components/user-menu';
import { api, send, type User } from '../lib/api';
import { useAuth } from '../lib/auth';

type Profile = {
  user: User;
  createdAt?: string;
  stats: { boards: number; owned: number };
  colors: string[];
};

export default function ProfilePage() {
  const router = useRouter();
  const { user, setUser, signOut } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [name, setName] = useState('');
  const [saved, setSaved] = useState('');
  const [error, setError] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordNotice, setPasswordNotice] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user === null) router.replace('/');
    if (user?.guest) router.replace('/?mode=signup');
  }, [user, router]);

  useEffect(() => {
    if (!user || user.guest) return;
    api<Profile>('/profile')
      .then((result) => {
        setProfile(result);
        setName(result.user.name);
      })
      .catch((caught) => setError((caught as Error).message));
  }, [user]);

  async function update(fields: { name?: string; color?: string }) {
    setError('');
    setSaved('');
    try {
      const result = await send<{ user: User }>('/profile', 'PATCH', fields);
      setUser(result.user);
      setProfile((current) =>
        current ? { ...current, user: result.user } : current,
      );
      setSaved(fields.name ? 'Name saved.' : 'Colour saved.');
    } catch (caught) {
      setError((caught as Error).message);
    }
  }

  async function changePassword(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setPasswordNotice(null);
    try {
      await send('/profile/password', 'POST', { currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setPasswordNotice({
        ok: true,
        text: 'Password changed. Other devices have been signed out.',
      });
    } catch (caught) {
      setPasswordNotice({ ok: false, text: (caught as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const current = profile?.user ?? user;

  return (
    <AppShell active="profile">
      <header className="main-header">
        <div className="main-title">
          <Link href="/" className="back-link">
            <Icon name="chevronLeft" size={16} /> Boards
          </Link>
          <h1>Profile &amp; settings</h1>
        </div>
      </header>

      {!current || current.guest || !profile ? (
        <div className="page-loading inline">
          {error ? (
            <p className="notice error">{error}</p>
          ) : (
            <span className="loader" />
          )}
        </div>
      ) : (
        <div className="main-body settings-layout">
          <aside className="profile-card">
            <div
              className="profile-card-banner"
              style={{ background: current.color }}
            />
            <Avatar name={current.name} color={current.color} size={84} />
            <h2>{current.name}</h2>
            <p>{current.email}</p>
            {profile.createdAt && (
              <small>
                Member since{' '}
                {new Date(profile.createdAt).toLocaleDateString([], {
                  month: 'long',
                  year: 'numeric',
                })}
              </small>
            )}
            <dl className="profile-stats">
              <div>
                <dt>Boards</dt>
                <dd>{profile.stats.boards}</dd>
              </div>
              <div>
                <dt>Created</dt>
                <dd>{profile.stats.owned}</dd>
              </div>
              <div>
                <dt>Shared</dt>
                <dd>{profile.stats.boards - profile.stats.owned}</dd>
              </div>
            </dl>
          </aside>

          <div className="settings-stack">
            <section className="settings-card">
              <div className="settings-head">
                <h2>Identity</h2>
                <p>
                  Your name and colour appear on your cursor, in chat, and in
                  voice calls.
                </p>
              </div>
              <form
                className="settings-row"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (name.trim() && name.trim() !== current.name)
                    void update({ name });
                }}
              >
                <label className="field grow">
                  <span>Display name</span>
                  <input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    maxLength={48}
                    required
                    autoComplete="name"
                  />
                </label>
                <button
                  className="button primary"
                  disabled={!name.trim() || name.trim() === current.name}
                >
                  Save
                </button>
              </form>
              <div className="field">
                <span>Cursor colour</span>
                <div
                  className="profile-colors"
                  role="radiogroup"
                  aria-label="Profile colour"
                >
                  {profile.colors.map((color) => (
                    <button
                      key={color}
                      role="radio"
                      aria-checked={current.color === color}
                      aria-label={`Colour ${color}`}
                      className={current.color === color ? 'is-active' : ''}
                      style={{ background: color }}
                      onClick={() => void update({ color })}
                    >
                      {current.color === color && (
                        <Icon name="check" size={15} strokeWidth={2.6} />
                      )}
                    </button>
                  ))}
                </div>
              </div>
              {saved && <p className="notice success">{saved}</p>}
              {error && <p className="notice error">{error}</p>}
            </section>

            <section className="settings-card">
              <div className="settings-head">
                <h2>Password</h2>
                <p>Changing it signs you out everywhere else.</p>
              </div>
              <form className="settings-grid" onSubmit={changePassword}>
                <label className="field">
                  <span>Current password</span>
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={(event) => setCurrentPassword(event.target.value)}
                    autoComplete="current-password"
                    required
                  />
                </label>
                <label className="field">
                  <span>New password</span>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    autoComplete="new-password"
                    placeholder="At least 8 characters"
                    minLength={8}
                    required
                  />
                </label>
                <div className="settings-actions">
                  <button
                    className="button ghost"
                    disabled={
                      busy || !currentPassword || newPassword.length < 8
                    }
                  >
                    Change password
                  </button>
                </div>
              </form>
              {passwordNotice && (
                <p
                  className={`notice ${passwordNotice.ok ? 'success' : 'error'}`}
                >
                  {passwordNotice.text}
                </p>
              )}
            </section>

            <section className="settings-card danger-zone">
              <div className="settings-head">
                <h2>Session</h2>
                <p>Sign out of CanvaRoom on this device.</p>
              </div>
              <div className="settings-actions">
                <button
                  className="button danger"
                  onClick={async () => {
                    await signOut();
                    router.push('/');
                  }}
                >
                  <Icon name="logout" size={17} /> Sign out
                </button>
              </div>
            </section>
          </div>
        </div>
      )}
    </AppShell>
  );
}
