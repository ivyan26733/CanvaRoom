import type { Metadata } from 'next';

// Private to signed-in members, so keep it out of search results.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function PrivateLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
