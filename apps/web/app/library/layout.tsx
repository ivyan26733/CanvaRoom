import type { Metadata } from 'next';
import { Suspense } from 'react';

// Managed from inside the app, so keep it out of search results.
export const metadata: Metadata = {
  title: 'Library',
  robots: { index: false, follow: false },
};

export default function LibraryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The page reads ?q= from the URL, which needs a boundary to prerender.
  return <Suspense>{children}</Suspense>;
}
