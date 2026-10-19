import type { Metadata } from 'next';
import { Dashboard } from './dashboard-client';

export const metadata: Metadata = {
  title: 'My boards',
  robots: { index: false, follow: false },
};

export default function DashboardPage() {
  return <Dashboard />;
}
