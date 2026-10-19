'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';
import { AppShell } from '../components/app-shell';
import { LibraryPanel } from '../components/library-panel';
import { useAuth } from '../lib/auth';

/** Install and remove library packs outside a board. */
export default function LibraryPage() {
  const router = useRouter();
  const { user } = useAuth();
  const initialQuery = useSearchParams().get('q') ?? '';

  useEffect(() => {
    if (user === null)
      router.replace(
        `/login?next=${encodeURIComponent(`/library${location.search}`)}`,
      );
  }, [user, router]);

  if (!user) return null;
  return (
    <AppShell active="library">
      <div className="lib-page-shell">
        <LibraryPanel
          synced={!user.guest}
          canInsert={false}
          variant="page"
          initialQuery={initialQuery}
        />
      </div>
    </AppShell>
  );
}
