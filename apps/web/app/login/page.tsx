import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoginClient } from './login-client';

export const metadata: Metadata = {
  title: 'Sign in',
  description:
    'Sign in to CanvaRoom to open your boards, rejoin your class, and pick up the lesson where you left it.',
  alternates: { canonical: '/login' },
  openGraph: { title: 'Sign in to CanvaRoom', url: '/login' },
};

export default function LoginPage() {
  return (
    <Suspense>
      <LoginClient />
    </Suspense>
  );
}
