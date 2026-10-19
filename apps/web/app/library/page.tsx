'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { AppShell } from '../components/app-shell';
import { LibraryPanel } from '../components/library-panel';
import { useAuth } from '../lib/auth';

/** Install and remove library packs outside a board. */
export default function LibraryPage() {
  const router = useRouter();
  const { user } = useAuth();

  useEffect(() => {
    if (user === null) router.replace('/login?next=/library');
  }, [user, router]);

  if (!user) return null;
  return (
    <AppShell active="library">
      <div className="lib-page-shell">
        <LibraryPanel synced={!user.guest} canInsert={false} variant="page" />
      </div>
    </AppShell>
  );
}
