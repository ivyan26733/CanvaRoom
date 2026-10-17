'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState, ViewTransition } from 'react';

const isBoard = (path: string) => path.startsWith('/board/');
/** The route shown before this one, kept across template remounts. */
let previousPath = '';

/**
 * Remounts on every navigation, so each route fades the old page out and
 * eases the new one in. `default="none"` keeps same-page updates still.
 *
 * Boards skip the fade both ways: while a view transition runs the page
 * cannot be clicked or drawn on, and a board should take the pen the moment
 * it appears. React starts a transition whenever a <ViewTransition> mounts,
 * so a board (and the page right after one) renders without it, and the page
 * being left gets the `board` transition type to skip its exit.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [still] = useState(() => isBoard(pathname) || isBoard(previousPath));
  useEffect(() => {
    previousPath = pathname;
  }, [pathname]);
  if (still) return <div className="route">{children}</div>;
  return (
    <ViewTransition
      enter="route-in"
      exit={{ board: 'none', default: 'route-out' }}
      default="none"
    >
      <div className="route">{children}</div>
    </ViewTransition>
  );
}
