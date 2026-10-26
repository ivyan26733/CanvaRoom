'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AuthScreen } from '../components/auth-screen';
import { send, type User } from '../lib/api';
import { useAuth } from '../lib/auth';
import { safeNext, withNext } from '../lib/next-url';

const COOLDOWN = 60;

export function VerifyClient() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get('next'));
  const { user, setUser } = useAuth();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(params.get('sent') ? COOLDOWN : 0);
  const [changing, setChanging] = useState(false);
  const [newEmail, setNewEmail] = useState('');

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((left) => left - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function verify(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await send<{ user: User }>('/auth/verify-email', 'POST', {
        code,
      });
      setUser(result.user);
    } catch (caught) {
      setError((caught as Error).message);
    }
    setBusy(false);
  }

  async function resend() {
    setBusy(true);
    setError('');
    try {
      const result = await send<{ message?: string; cooldown?: number }>(
        '/auth/resend-verification',
        'POST',
        {},
      );
      setNotice(
        result.message ??
          'A new code is on its way. Check your inbox and spam folder.',
      );
      setCooldown(result.cooldown ?? COOLDOWN);
      setCode('');
    } catch (caught) {
      setError((caught as Error).message);
    }
    setBusy(false);
  }

  async function changeEmail(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await send<{ user: User }>('/auth/change-email', 'POST', {
        email: newEmail,
      });
      setUser(result.user);
      setChanging(false);
      setCode('');
      setNotice(
        `We’ve sent a new code to ${result.user.email}. Check your inbox and spam folder.`,
      );
      setCooldown(COOLDOWN);
    } catch (caught) {
      setError((caught as Error).message);
    }
    setBusy(false);
  }

  let body: React.ReactNode;
  if (user === undefined) body = <span className="loader" />;
  else if (!user || user.guest)
    body = (
      <>
        <h1>Sign in to verify</h1>
        <p className="auth-lede">
          Sign in to the account you created, then enter the code from the
          email.
        </p>
        <Link
          className="button primary wide"
          href={withNext('/login', '/verify-email')}
        >
          Sign in
        </Link>
      </>
    );
  else if (user.emailVerified !== false)
    body = (
      <>
        <h1>You’re verified</h1>
        <p className="auth-lede">
          {user.email} is confirmed. Your boards are ready.
        </p>
        <button
          className="button primary wide"
          onClick={() => router.replace(next)}
        >
          Continue <span aria-hidden="true">→</span>
        </button>
      </>
    );
  else if (!user.verifyAvailable)
    body = (
      <>
        <h1>Verification is coming soon</h1>
        <p className="auth-lede">
          We can’t email codes just yet. You can use CanvaRoom normally, and
          we’ll ask you to confirm {user.email} later.
        </p>
        <button
          className="button primary wide"
          onClick={() => router.replace(next)}
        >
          Continue <span aria-hidden="true">→</span>
        </button>
      </>
    );
  else
    body = (
      <>
        <h1>Enter your code</h1>
        <p className="auth-lede">
          We sent a 6-digit code to your email. It works for 10 minutes. Check
          your inbox and spam folder.
        </p>
        {changing ? (
          <form className="auth-form" onSubmit={changeEmail} noValidate>
            <label className="auth-field">
              <span>New email</span>
              <input
                type="email"
                value={newEmail}
                onChange={(event) => setNewEmail(event.target.value)}
                autoComplete="email"
                maxLength={254}
                required
                autoFocus
              />
            </label>
            {error && (
              <p className="notice error" role="alert">
                {error}
              </p>
            )}
            <button
              className="button primary auth-submit"
              disabled={busy || !newEmail.trim()}
            >
              {busy ? 'One moment…' : 'Send code to this email'}
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setChanging(false);
                setError('');
              }}
            >
              Keep {user.email}
            </button>
          </form>
        ) : (
          <form className="auth-form" onSubmit={verify} noValidate>
            <p className="verify-email-line">
              <span>{user.email}</span>
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setChanging(true);
                  setNewEmail(user.email ?? '');
                  setError('');
                  setNotice('');
                }}
              >
                Change
              </button>
            </p>
            <label className="auth-field">
              <span>6-digit code</span>
              <input
                className="code-input"
                value={code}
                onChange={(event) =>
                  setCode(event.target.value.replace(/\D/g, '').slice(0, 6))
                }
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="••••••"
                maxLength={6}
                required
                autoFocus
              />
            </label>
            {notice && (
              <p className="notice success" role="status">
                {notice}
              </p>
            )}
            {error && (
              <p className="notice error" role="alert">
                {error}
              </p>
            )}
            <button
              className="button primary auth-submit"
              disabled={busy || code.length !== 6}
            >
              {busy ? 'Checking…' : 'Verify email'}
            </button>
            <div className="verify-actions">
              <button
                type="button"
                className="text-button"
                disabled={busy || cooldown > 0}
                onClick={resend}
              >
                {cooldown > 0
                  ? `Send a new code in ${cooldown}s`
                  : 'Send a new code'}
              </button>
              <button
                type="button"
                className="text-button"
                onClick={() => router.replace(next)}
              >
                I’ll do it later
              </button>
            </div>
          </form>
        )}
      </>
    );

  return (
    <AuthScreen scene="verify">
      <div aria-live="polite">{body}</div>
    </AuthScreen>
  );
}
