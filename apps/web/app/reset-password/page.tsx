'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Icon, Logo } from '../components/icons';
import { send, type User } from '../lib/api';
import { useAuth } from '../lib/auth';

export default function ResetPasswordPage() {
  const router = useRouter();
  const { setUser } = useAuth();
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setToken(new URLSearchParams(location.search).get('token'));
    // Keep the single-use token out of history and referrers.
    window.history.replaceState(null, '', '/reset-password');
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (password !== confirm) {
      setError('The two passwords don’t match.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const { user } = await send<{ user: User }>('/auth/reset', 'POST', {
        token,
        password,
      });
      setUser(user);
      router.replace('/');
    } catch (caught) {
      setError((caught as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="board-gate">
      <Link className="brand" href="/">
        <Logo />
        <span>CanvaRoom</span>
      </Link>
      <div className="gate-card">
        <span className="gate-icon">
          <Icon name="lock" size={22} />
        </span>
        {token === null ? (
          <>
            <h1>This link is incomplete.</h1>
            <p>Open the link from your email again, or request a new one.</p>
            <Link className="button primary wide" href="/">
              Back to sign in
            </Link>
          </>
        ) : (
          <>
            <h1>Choose a new password</h1>
            <p>You’ll be signed in, and signed out on every other device.</p>
            <form className="auth-form" onSubmit={submit} noValidate>
              <label className="auth-field">
                <span>New password</span>
                <div className="password-row">
                  <input
                    type={show ? 'text' : 'password'}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="At least 8 characters"
                    autoComplete="new-password"
                    minLength={8}
                    maxLength={200}
                    required
                    autoFocus
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    onClick={() => setShow((value) => !value)}
                    aria-label={show ? 'Hide password' : 'Show password'}
                  >
                    {show ? 'Hide' : 'Show'}
                  </button>
                </div>
              </label>
              <label className="auth-field">
                <span>Confirm new password</span>
                <input
                  type={show ? 'text' : 'password'}
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                  autoComplete="new-password"
                  maxLength={200}
                  required
                />
              </label>
              {error && (
                <p className="notice error" role="alert">
                  {error}
                  {/expired|used/.test(error) && (
                    <Link href="/" className="notice-link">
                      Request a new link
                    </Link>
                  )}
                </p>
              )}
              <button
                className="button primary auth-submit"
                disabled={busy || password.length < 8 || !token}
              >
                {busy ? 'Saving…' : 'Save and sign in'}
              </button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
