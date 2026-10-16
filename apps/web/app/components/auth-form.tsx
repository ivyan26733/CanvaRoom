'use client';

import { useState } from 'react';
import { send, type User } from '../lib/api';
import { useAuth } from '../lib/auth';

type Mode = 'login' | 'signup' | 'guest';

/** Sign in, create an account, or (on invite links) join as a guest. */
export function AuthForm({
  initialMode = 'login',
  allowGuest = false,
  onDone,
}: {
  initialMode?: Mode;
  allowGuest?: boolean;
  onDone?: (user: User) => void;
}) {
  const { setUser } = useAuth();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { user } =
        mode === 'login'
          ? await send<{ user: User }>('/auth/login', 'POST', {
              email,
              password,
            })
          : mode === 'signup'
            ? await send<{ user: User }>('/auth/signup', 'POST', {
                name,
                email,
                password,
              })
            : await send<{ user: User }>('/auth/guest', 'POST', { name });
      setUser(user);
      onDone?.(user);
    } catch (caught) {
      setError((caught as Error).message);
      setBusy(false);
    }
  }

  const tabs: { mode: Mode; label: string }[] = [
    { mode: 'login', label: 'Sign in' },
    { mode: 'signup', label: 'Create account' },
    ...(allowGuest ? [{ mode: 'guest' as const, label: 'Guest' }] : []),
  ];

  return (
    <form className="auth-form" onSubmit={submit} noValidate>
      <div className="auth-tabs" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.mode}
            type="button"
            role="tab"
            aria-selected={mode === tab.mode}
            className={mode === tab.mode ? 'is-active' : ''}
            onClick={() => {
              setMode(tab.mode);
              setError('');
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {mode !== 'login' && (
        <label className="auth-field">
          <span>Your name</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="How others will see you"
            autoComplete="name"
            maxLength={48}
            required
            autoFocus
          />
        </label>
      )}
      {mode !== 'guest' && (
        <>
          <label className="auth-field">
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              maxLength={254}
              required
              autoFocus={mode === 'login'}
            />
          </label>
          <label className="auth-field">
            <span>Password</span>
            <div className="password-row">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={mode === 'signup' ? 'At least 8 characters' : ''}
                autoComplete={
                  mode === 'signup' ? 'new-password' : 'current-password'
                }
                minLength={mode === 'signup' ? 8 : undefined}
                maxLength={200}
                required
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword((shown) => !shown)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </label>
        </>
      )}
      {mode === 'guest' && (
        <p className="auth-hint">
          Guests can draw, chat, and talk on this board. Create an account any
          time to keep your boards and make your own.
        </p>
      )}

      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <button className="button primary auth-submit" disabled={busy}>
        {busy
          ? 'One moment…'
          : mode === 'login'
            ? 'Sign in'
            : mode === 'signup'
              ? 'Create account'
              : 'Join as guest'}
        {!busy && <span aria-hidden="true">→</span>}
      </button>
    </form>
  );
}
