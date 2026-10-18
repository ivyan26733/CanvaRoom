'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';
import { AuthForm } from '../components/auth-form';
import { AuthScreen } from '../components/auth-screen';
import { useAuth } from '../lib/auth';
import { safeNext, withNext } from '../lib/next-url';

export function LoginClient() {
  const router = useRouter();
  const { user } = useAuth();
  const next = safeNext(useSearchParams().get('next'));

  // Someone already signed in goes straight on.
  useEffect(() => {
    if (user && !user.guest) router.replace(next);
  }, [user, next, router]);

  return (
    <AuthScreen
      scene="login"
      aside={
        <span>
          New here?{' '}
          <Link href={withNext('/signup', next)}>Create an account</Link>
        </span>
      }
    >
      <h1>Welcome back</h1>
      <p className="auth-lede">Sign in to pick up where your class left off.</p>
      <AuthForm
        standalone
        initialMode="login"
        onDone={() => router.replace(next)}
        onForgot={(email) => {
          const params = new URLSearchParams();
          if (email) params.set('email', email);
          if (next !== '/') params.set('next', next);
          const query = params.toString();
          router.push(`/forgot-password${query ? `?${query}` : ''}`);
        }}
      />
      <p className="auth-alt">
        No account yet?{' '}
        <Link href={withNext('/signup', next)}>Start your free trial</Link>
      </p>
    </AuthScreen>
  );
}
