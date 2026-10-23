'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { BoardListItem } from '../lib/api';
import { useAuth } from '../lib/auth';
import { PlanChip } from '../lib/billing';
import { BOARD_NAV } from '../lib/navigation';
import { DASHBOARD } from '../lib/next-url';
import { openFeedback } from './feedback';
import { Icon, Logo, type IconName } from './icons';
import { SiteHeader } from './site-header';
import { UserMenu } from './user-menu';

export type DashboardView = 'all' | 'mine' | 'shared';

const NAV: { view: DashboardView; label: string; icon: IconName }[] = [
  { view: 'all', label: 'All boards', icon: 'grid' },
  { view: 'mine', label: 'Created by me', icon: 'user' },
  { view: 'shared', label: 'Shared with me', icon: 'users' },
];

/** Sidebar layout shared by the dashboard and account pages. */
export function AppShell({
  children,
  active,
  onView,
  onNewBoard,
  onUpgrade,
  recent,
  counts,
}: {
  children: React.ReactNode;
  /** The highlighted nav item; `profile` when on the account page. */
  active: DashboardView | 'profile' | 'library';
  /** On the dashboard, nav switches views in place instead of navigating. */
  onView?: (view: DashboardView) => void;
  onNewBoard?: () => void;
  onUpgrade?: () => void;
  recent?: BoardListItem[] | undefined;
  counts?: Partial<Record<DashboardView, number>> | undefined;
}) {
  const { user } = useAuth();
  const [navOpen, setNavOpen] = useState(false);

  return (
    <div className={`app-shell ${navOpen ? 'nav-open' : ''}`}>
      <aside className="app-sidebar" aria-label="Main">
        <div className="sidebar-top">
          <Link className="brand" href="/" onClick={() => setNavOpen(false)}>
            <Logo />
            <span>CanvaRoom</span>
          </Link>
          <button
            className="icon-button sidebar-close"
            aria-label="Close menu"
            onClick={() => setNavOpen(false)}
          >
            <Icon name="close" />
          </button>
        </div>

        {onNewBoard && (
          <button
            className="button primary new-board-button"
            onClick={() => {
              setNavOpen(false);
              onNewBoard();
            }}
          >
            <Icon name="plus" size={17} strokeWidth={2.2} />
            New board
          </button>
        )}

        <nav className="sidebar-nav">
          {NAV.map((item) => {
            const content = (
              <>
                <Icon name={item.icon} />
                <span>{item.label}</span>
                {counts?.[item.view] !== undefined && (
                  <span className="nav-count">{counts[item.view]}</span>
                )}
              </>
            );
            const className = `nav-item ${active === item.view ? 'is-active' : ''}`;
            return onView ? (
              <button
                key={item.view}
                className={className}
                onClick={() => {
                  setNavOpen(false);
                  onView(item.view);
                }}
              >
                {content}
              </button>
            ) : (
              <Link
                key={item.view}
                className={className}
                href={
                  item.view === 'all'
                    ? DASHBOARD
                    : `${DASHBOARD}?view=${item.view}`
                }
              >
                {content}
              </Link>
            );
          })}
          <Link
            className={`nav-item ${active === 'library' ? 'is-active' : ''}`}
            href="/library"
          >
            <Icon name="library" />
            <span>Library</span>
          </Link>
          {user && !user.guest && (
            <Link
              className={`nav-item ${active === 'profile' ? 'is-active' : ''}`}
              href="/profile"
            >
              <Icon name="sliders" />
              <span>Profile &amp; settings</span>
            </Link>
          )}
          {user?.role === 'admin' && (
            <Link className="nav-item" href="/admin">
              <Icon name="sliders" />
              <span>Admin panel</span>
            </Link>
          )}
          <button className="nav-item" type="button" onClick={openFeedback}>
            <Icon name="chat" />
            <span>Send feedback</span>
          </button>
        </nav>

        {recent && recent.length > 0 && (
          <div className="sidebar-section">
            <p className="sidebar-label">Recent</p>
            {recent.slice(0, 6).map((board) => (
              <Link
                key={board.id}
                href={`/board/${board.id}`}
                transitionTypes={BOARD_NAV.transitionTypes}
                className="recent-item"
              >
                <span
                  className="recent-swatch"
                  style={{ background: swatchFor(board.id) }}
                />
                <span>{board.title}</span>
              </Link>
            ))}
          </div>
        )}

        <div className="sidebar-bottom">
          {user?.guest && onUpgrade && (
            <div className="sidebar-upgrade">
              <strong>Keep your work</strong>
              <p>
                You’re on a guest pass. Make a free account to create boards.
              </p>
              <button className="button primary small" onClick={onUpgrade}>
                Create account
              </button>
            </div>
          )}
          <PlanChip className="sidebar-plan" />
          <UserMenu variant="row" placement="above" />
        </div>
      </aside>

      <div className="app-main">
        <SiteHeader variant="app" onOpenSidebar={() => setNavOpen(true)} />
        <VerifyBanner />
        {children}
      </div>
      <div
        className="sidebar-scrim"
        aria-hidden="true"
        onClick={() => setNavOpen(false)}
      />
    </div>
  );
}

const SWATCHES = [
  '#ff4f1f',
  '#2d5bff',
  '#12a150',
  '#f5a623',
  '#7c4dff',
  '#e8458b',
];
export function swatchFor(id: string) {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return SWATCHES[Math.abs(hash) % SWATCHES.length]!;
}

export function timeAgo(iso: string) {
  const seconds = (Date.now() - Date.parse(iso)) / 1000;
  if (!Number.isFinite(seconds)) return '';
  if (seconds < 45) return 'just now';
  const minutes = seconds / 60;
  if (minutes < 60) return `${Math.round(minutes)}m ago`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.round(hours)}h ago`;
  const days = hours / 24;
  if (days < 7) return `${Math.round(days)}d ago`;
  return new Date(iso).toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
  });
}

/** Asks account holders to confirm their email, once codes can be sent. */
function VerifyBanner() {
  const { user } = useAuth();
  if (!user || user.guest || user.emailVerified !== false) return null;
  if (!user.verifyAvailable) return null;
  return (
    <div className="verify-banner" role="status">
      <Icon name="inbox" size={16} />
      <span>
        Verify <strong>{user.email}</strong> to upgrade and keep your account
        safe.
      </span>
      <Link href="/verify-email" className="button small primary">
        Enter code
      </Link>
    </div>
  );
}
