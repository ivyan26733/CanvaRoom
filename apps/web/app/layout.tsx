import type { Metadata } from 'next';
import './styles.css';

export const metadata: Metadata = {
  title: 'CollabBoard',
  description: 'A shared space for classroom ideas.',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
