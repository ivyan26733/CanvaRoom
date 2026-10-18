'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Icon, Logo } from '../components/icons';
import { send, type User } from '../lib/api';
import { useAuth } from '../lib/auth';

export default function VerifyEmailPage() {
  const router = useRouter();
  const { setUser } = useAuth();
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setToken(new URLSearchParams(location.search).get('token'));
    window.history.replaceState(null, '', '/verify-email');
  }, []);

  async function verify() {
    if (!token) return;
    setBusy(true);
    setError('');
    try {
      const { user } = await send<{ user: User }>(
        '/auth/verify-email',
        'POST',
        {
          token,
        },
      );
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
        <h1>Verify your email</h1>
        <p>
          Confirm your email address to finish creating your CanvaRoom account.
        </p>
        {token === null ? (
          <>
            <p className="notice error" role="alert">
              This link is incomplete. Request a new verification email and open
              its link.
            </p>
            <Link className="button primary wide" href="/?mode=signup">
              Back to CanvaRoom
            </Link>
          </>
        ) : (
          <>
            {error && (
              <p className="notice error" role="alert">
                {error}
              </p>
            )}
            <button
              className="button primary wide"
              onClick={verify}
              disabled={busy || token === undefined}
            >
              {busy
                ? 'Verifying…'
                : token === undefined
                  ? 'Loading…'
                  : 'Verify email'}
            </button>
          </>
        )}
      </div>
    </main>
  );
}
