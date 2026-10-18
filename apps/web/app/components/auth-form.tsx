'use client';

import { useState } from 'react';
import { send, type User } from '../lib/api';
import { useAuth } from '../lib/auth';

type Mode = 'login' | 'signup' | 'guest' | 'forgot';

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
  const [sent, setSent] = useState('');
  const [verificationSent, setVerificationSent] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    if (mode === 'forgot') {
      try {
        const result = await send<{ message: string }>('/auth/forgot', 'POST', {
          email,
        });
        setSent(result.message);
      } catch (caught) {
        setError((caught as Error).message);
      }
      setBusy(false);
      return;
    }
    try {
      if (mode === 'signup') {
        const result = await send<{ message: string }>('/auth/signup', 'POST', {
          name,
          email,
          password,
        });
        setSent(result.message);
        setBusy(false);
        return;
      }
      const { user } =
        mode === 'login'
          ? await send<{ user: User }>('/auth/login', 'POST', {
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

  if (mode === 'forgot')
    return (
      <form className="auth-form" onSubmit={submit} noValidate>
        <div className="auth-heading">
          <strong>Reset your password</strong>
          <span>We’ll email you a link to choose a new one.</span>
        </div>
        {sent ? (
          <p className="notice success" role="status">
            {sent}
          </p>
        ) : (
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
              autoFocus
            />
          </label>
        )}
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        {!sent && (
          <button
            className="button primary auth-submit"
            disabled={busy || !email.trim()}
          >
            {busy ? 'Sending…' : 'Send reset link'}
          </button>
        )}
        <button
          type="button"
          className="text-button"
          onClick={() => {
            setMode('login');
            setSent('');
            setError('');
          }}
        >
          Back to sign in
        </button>
      </form>
    );

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
              setSent('');
              setVerificationSent('');
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {mode === 'signup' && sent ? (
        <>
          <p className="notice success" role="status">
            {sent}
          </p>
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                const result = await send<{ message: string }>(
                  '/auth/resend-verification',
                  'POST',
                  { email },
                );
                setSent(result.message);
              } catch (caught) {
                setError((caught as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Sending…' : 'Resend verification email'}
          </button>
          {error && (
            <p className="notice error" role="alert">
              {error}
            </p>
          )}
        </>
      ) : (
        <>
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
                    placeholder={
                      mode === 'signup' ? 'At least 8 characters' : ''
                    }
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
                    aria-label={
                      showPassword ? 'Hide password' : 'Show password'
                    }
                  >
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
              </label>
            </>
          )}
          {mode === 'guest' && (
            <p className="auth-hint">
              Guests can draw, chat, and talk on this board. Create an account
              any time to keep your boards and make your own.
            </p>
          )}

          {mode === 'login' && (
            <button
              type="button"
              className="text-button forgot-link"
              onClick={() => {
                setMode('forgot');
                setError('');
              }}
            >
              Forgot password?
            </button>
          )}
          {mode === 'login' && error.startsWith('Verify your email') && (
            <>
              <button
                type="button"
                className="text-button"
                disabled={busy || !email.trim()}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const result = await send<{ message: string }>(
                      '/auth/resend-verification',
                      'POST',
                      { email },
                    );
                    setVerificationSent(result.message);
                  } catch (caught) {
                    setError((caught as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? 'Sending…' : 'Resend verification email'}
              </button>
              {verificationSent && (
                <p className="notice success" role="status">
                  {verificationSent}
                </p>
              )}
            </>
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
        </>
      )}
    </form>
  );
}
