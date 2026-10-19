import type { Metadata } from 'next';

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
  return children;
}
