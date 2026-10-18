import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ForgotClient } from './forgot-client';

export const metadata: Metadata = {
  title: 'Reset your password',
  alternates: { canonical: '/forgot-password' },
  robots: { index: false, follow: false },
};

export default function ForgotPasswordPage() {
  return (
    <Suspense>
      <ForgotClient />
    </Suspense>
  );
}
