'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { AuthForm } from '../components/auth-form';
import { AuthScreen } from '../components/auth-screen';
import type { User } from '../lib/api';
import { useAuth } from '../lib/auth';
import { DASHBOARD, safeNext, withNext } from '../lib/next-url';

export function SignupClient() {
  const router = useRouter();
  const { user } = useAuth();
  const next = safeNext(useSearchParams().get('next'));
  const signingUp = useRef(false);

  // Someone already signed in goes straight on.
  useEffect(() => {
    if (user && !user.guest && !signingUp.current) router.replace(next);
  }, [user, next, router]);

  function done(created: User) {
    signingUp.current = true;
    // With email working, confirm the address first; the code is on its way.
    if (created.verifyAvailable && created.emailVerified === false)
      router.replace(
        `/verify-email?sent=1${next !== DASHBOARD ? `&next=${encodeURIComponent(next)}` : ''}`,
      );
    else router.replace(next);
  }

  return (
    <AuthScreen
      scene="signup"
      aside={
        <span>
          Have an account? <Link href={withNext('/login', next)}>Sign in</Link>
        </span>
      }
    >
      <p className="auth-trial-badge">Free trial · no card needed</p>
      <h1>Create your studio</h1>
      <p className="auth-lede">
        30 minutes of active use free, then a free plan to keep your first
        board.
      </p>
      <AuthForm standalone initialMode="signup" onDone={done} />
      <p className="auth-alt">
        Already teaching here?{' '}
        <Link href={withNext('/login', next)}>Sign in</Link>
      </p>
    </AuthScreen>
  );
}
