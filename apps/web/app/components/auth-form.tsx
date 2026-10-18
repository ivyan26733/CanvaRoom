'use client';

import { useState } from 'react';
import { send, type User } from '../lib/api';
import { useAuth } from '../lib/auth';

type Mode = 'login' | 'signup' | 'guest' | 'forgot';

/** Sign in, create an account, or (on invite links) join as a guest. */
export function AuthForm({
  initialMode = 'login',
  allowGuest = false,
  standalone = false,
  initialEmail = '',
  onDone,
  onForgot,
  onBack,
}: {
  initialEmail?: string;
  /** Leaves password recovery on a standalone page. */
  onBack?: () => void;
  initialMode?: Mode;
  allowGuest?: boolean;
  /** On its own page: one mode, no tabs. */
  standalone?: boolean;
  onDone?: (user: User) => void;
  /** Opens password recovery elsewhere instead of inside this form. */
  onForgot?: (email: string) => void;
}) {
  const { setUser } = useAuth();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [name, setName] = useState('');
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    if (mode === 'forgot') {
      try {
        if (!sent) {
          const result = await send<{ message: string }>(
            '/auth/forgot',
            'POST',
            { email },
          );
          setSent(result.message);
          setBusy(false);
          return;
        }
        const { user } = await send<{ user: User }>('/auth/reset', 'POST', {
          email,
          code,
          password,
        });
        setUser(user);
        onDone?.(user);
      } catch (caught) {
        setError((caught as Error).message);
        setBusy(false);
      }
      return;
    }
    try {
      if (mode === 'signup') {
        const result = await send<{ user?: User; message?: string }>(
          '/auth/signup',
          'POST',
          { name, email, password },
        );
        if (result.user) {
          setUser(result.user);
          onDone?.(result.user);
          return;
        }
        setSent(result.message ?? 'Check your email to finish signing up.');
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
        {!standalone && (
          <div className="auth-heading">
            <strong>Reset your password</strong>
            <span>
              {sent
                ? 'Enter the code from the email and choose a new password.'
                : 'We’ll email you a 6-digit code.'}
            </span>
          </div>
        )}
        {sent && (
          <p className="notice success" role="status">
            {sent}
          </p>
        )}
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
            readOnly={Boolean(sent)}
            autoFocus={!sent}
          />
        </label>
        {sent && (
          <>
            <label className="auth-field">
              <span>6-digit code</span>
              <input
                value={code}
                onChange={(event) =>
                  setCode(event.target.value.replace(/\D/g, '').slice(0, 6))
                }
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                placeholder="123456"
                maxLength={6}
                required
                autoFocus
              />
            </label>
            <label className="auth-field">
              <span>New password</span>
              <div className="password-row">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="At least 8 characters"
                  autoComplete="new-password"
                  minLength={8}
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
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        <button
          className="button primary auth-submit"
          disabled={
            busy ||
            !email.trim() ||
            (Boolean(sent) && (code.length !== 6 || password.length < 8))
          }
        >
          {busy ? 'One moment…' : sent ? 'Set new password' : 'Send code'}
        </button>
        {sent && (
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => {
              setSent('');
              setCode('');
              setError('');
            }}
          >
            Didn’t get it? Send a new code
          </button>
        )}
        <button
          type="button"
          className="text-button"
          onClick={() => {
            if (onBack) return onBack();
            setMode('login');
            setSent('');
            setCode('');
            setError('');
          }}
        >
          Back to sign in
        </button>
      </form>
    );

  return (
    <form className="auth-form" onSubmit={submit} noValidate>
      {!standalone && (
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
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}
      {mode !== 'login' && (
        <label className="auth-field">
          <span>Your name</span>
          <input
            name="name"
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
              name="email"
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
                name="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={mode === 'signup' ? 'At least 8 characters' : ''}
                autoComplete={
                  mode === 'signup' ? 'new-password' : 'current-password'
                }
                minLength={mode === 'signup' ? 8 : undefined}
                maxLength={200}
                aria-describedby={
                  mode === 'signup' ? 'password-strength' : undefined
                }
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
          {mode === 'signup' && <PasswordStrength password={password} />}
        </>
      )}
      {mode === 'guest' && (
        <p className="auth-hint">
          Guests can draw, chat, and talk on this board. Create an account any
          time to keep your boards and make your own.
        </p>
      )}
      {mode === 'login' && (
        <button
          type="button"
          className="text-button forgot-link"
          onClick={() => {
            if (onForgot) onForgot(email);
            else {
              setMode('forgot');
              setError('');
            }
          }}
        >
          Forgot password?
        </button>
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

/** A plain-language hint about how guessable a new password is. */
function PasswordStrength({ password }: { password: string }) {
  const score = passwordScore(password);
  const labels = ['Too short', 'Weak', 'Okay', 'Strong', 'Very strong'];
  return (
    <div
      id="password-strength"
      className={`password-strength is-${score}`}
      aria-live="polite"
    >
      <span className="password-meter" aria-hidden="true">
        {[1, 2, 3, 4].map((step) => (
          <i key={step} className={score >= step ? 'on' : ''} />
        ))}
      </span>
      <span>
        {password ? labels[score] : 'Use 8 or more characters'}
        {password && score < 3 ? ' · mix words, numbers, or symbols' : ''}
      </span>
    </div>
  );
}

export function passwordScore(password: string) {
  if (password.length < 8) return 0;
  let score = 1;
  if (password.length >= 12) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password) && /[^A-Za-z0-9]/.test(password)) score += 1;
  else if (/\d|[^A-Za-z0-9]/.test(password) && password.length >= 10)
    score += 1;
  return Math.min(4, score);
}
