import { ViewTransition } from 'react';

/**
 * Remounts on every navigation, so each route fades the old page out and
 * eases the new one in. `default="none"` keeps same-page updates still.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <ViewTransition enter="route-in" exit="route-out" default="none">
      <div className="route">{children}</div>
    </ViewTransition>
  );
}
