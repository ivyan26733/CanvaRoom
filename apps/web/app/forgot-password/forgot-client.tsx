'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AuthForm } from '../components/auth-form';
import { AuthScreen } from '../components/auth-screen';
import { safeNext, withNext } from '../lib/next-url';

export function ForgotClient() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get('next'));
  return (
    <AuthScreen
      scene="recover"
      aside={
        <span>
          Remembered it? <Link href={withNext('/login', next)}>Sign in</Link>
        </span>
      }
    >
      <h1>Forgot your password?</h1>
      <p className="auth-lede">
        Enter your email and we’ll send you a 6-digit code to choose a new one.
      </p>
      <AuthForm
        standalone
        initialMode="forgot"
        initialEmail={params.get('email')?.slice(0, 254) ?? ''}
        onDone={() => router.replace(next)}
        onBack={() => router.push(withNext('/login', next))}
      />
    </AuthScreen>
  );
}
