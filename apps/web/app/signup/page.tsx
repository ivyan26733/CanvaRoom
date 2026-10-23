import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SignupClient } from './signup-client';

export const metadata: Metadata = {
  title: 'Create your free account',
  description:
    'Start a free trial with Avenor: a live online whiteboard with voice, chat, and instant ink for tutors, classrooms, and teams. No card needed.',
  alternates: { canonical: '/signup' },
  openGraph: { title: 'Start free on Avenor', url: '/signup' },
};

export default function SignupPage() {
  return (
    <Suspense>
      <SignupClient />
    </Suspense>
  );
}
