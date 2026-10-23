'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../lib/auth';
import { PlanChip } from '../lib/billing';
import { DASHBOARD, NEW_BOARD_EVENT } from '../lib/next-url';
import { USE_CASES } from '../lib/site';
import { Icon, Logo } from './icons';
import { JoinBoardModal } from './join-board';
import { SiteSearch } from './site-search';
import { ThemeToggle } from './theme-toggle';
import { useDismiss, UserMenu } from './user-menu';
import './site-header.css';

/** Every page, in the order the header lists them. */
const LINKS = [
  { href: '/', label: 'Home' },
  { href: '/#features', label: 'Features' },
  { href: '/library', label: 'Library' },
  { href: '/#pricing', label: 'Pricing' },
  { href: '/about', label: 'About' },
  { href: '/contact', label: 'Contact' },
];

/**
 * The header on every page except a board: the logo, search in the middle,
 * the account on the right, and a strip with a link to every page.
 * `compact` drops the strip, for the sign-in pages; `app` sits above the
 * dashboard's sidebar layout and can open that sidebar on phones.
 */
export function SiteHeader({
  variant = 'full',
  onOpenSidebar,
}: {
  variant?: 'full' | 'compact' | 'app';
  onOpenSidebar?: () => void;
}) {
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [sheet, setSheet] = useState(false);
  const [joining, setJoining] = useState(false);
  const [searching, setSearching] = useState(false);
  const signedIn = Boolean(user && !user.guest);

  // A route change closes the phone menu and search.
  const [shownPath, setShownPath] = useState(pathname);
  if (shownPath !== pathname) {
    setShownPath(pathname);
    setSheet(false);
    setSearching(false);
  }

  useEffect(() => {
    if (!sheet) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSheet(false);
    };
    window.addEventListener('keydown', onKey);
    document.documentElement.classList.add('sh-locked');
    return () => {
      window.removeEventListener('keydown', onKey);
      document.documentElement.classList.remove('sh-locked');
    };
  }, [sheet]);

  // Board actions live here rather than in a toolbar under the header.
  // Guests can join boards and see the account prompt from "New board".
  const boardActions =
    variant !== 'compact' && (signedIn || (user?.guest && variant === 'app'));
  const onDashboard = pathname === DASHBOARD;

  function newBoard() {
    setSheet(false);
    if (onDashboard) window.dispatchEvent(new Event(NEW_BOARD_EVENT));
    else router.push(`${DASHBOARD}?new=1`);
  }
  function joinBoard() {
    setSheet(false);
    setJoining(true);
  }

  const isCurrent = (href: string) =>
    href === '/' ? pathname === '/' : !href.includes('#') && pathname === href;

  const account =
    user === undefined ? (
      <span className="sh-account-placeholder" />
    ) : signedIn ? (
      <>
        {!onDashboard && (
          <Link href={DASHBOARD} className="button ghost small sh-boards">
            <Icon name="grid" size={16} />
            <span>My boards</span>
          </Link>
        )}
        <PlanChip className="sh-plan" />
        <UserMenu />
      </>
    ) : (
      <>
        <span className="sh-theme">
          <ThemeToggle />
        </span>
        {user?.guest && <UserMenu />}
        <Link href="/login" className="button ghost small sh-login">
          Log in
        </Link>
        <Link href="/signup" className="button primary small">
          Start free trial
        </Link>
      </>
    );

  return (
    <header className={`sh sh-${variant} ${searching ? 'is-searching' : ''}`}>
      <div className="sh-bar">
        <div className="sh-start">
          {onOpenSidebar && (
            <button
              className="icon-button sh-sidebar"
              aria-label="Open board menu"
              onClick={onOpenSidebar}
            >
              <Icon name="sidebar" />
            </button>
          )}
          <Link href="/" className="sh-brand" aria-label="CanvaRoom home">
            <Logo size={28} />
            <span>CanvaRoom</span>
          </Link>
        </div>

        <div className="sh-search">
          <SiteSearch onNavigate={() => setSearching(false)} />
        </div>

        <div className="sh-end">
          <button
            className="icon-button sh-search-toggle"
            aria-label={searching ? 'Close search' : 'Search'}
            aria-expanded={searching}
            onClick={() => setSearching((open) => !open)}
          >
            <Icon name={searching ? 'close' : 'search'} />
          </button>
          {boardActions && (
            <div className="sh-actions">
              <button
                type="button"
                className="button ghost small sh-join"
                onClick={joinBoard}
                aria-label="Join a board with an invite link"
                title="Join with link"
              >
                <Icon name="link" size={16} />
                <span>Join link</span>
              </button>
              <button
                type="button"
                className="button primary small sh-new"
                onClick={newBoard}
              >
                <Icon name="plus" size={16} strokeWidth={2.2} />
                <span>New board</span>
              </button>
            </div>
          )}
          <div className="sh-account">{account}</div>
          <button
            className="icon-button sh-menu-toggle"
            aria-label="Open menu"
            aria-expanded={sheet}
            onClick={() => setSheet(true)}
          >
            <Icon name="list" />
          </button>
        </div>
      </div>

      {searching && (
        <div className="sh-search-mobile">
          <SiteSearch autoFocus onNavigate={() => setSearching(false)} />
        </div>
      )}

      {variant !== 'compact' && (
        <nav className="sh-nav" aria-label="Site">
          <ul>
            {LINKS.slice(0, 2).map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  aria-current={isCurrent(link.href) ? 'page' : undefined}
                >
                  {link.label}
                </Link>
              </li>
            ))}
            <li>
              <UseCasesMenu pathname={pathname} />
            </li>
            {LINKS.slice(2).map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  aria-current={isCurrent(link.href) ? 'page' : undefined}
                >
                  {link.label}
                </Link>
              </li>
            ))}
            {signedIn && (
              <li>
                <Link
                  href={DASHBOARD}
                  aria-current={pathname === DASHBOARD ? 'page' : undefined}
                >
                  My boards
                </Link>
              </li>
            )}
          </ul>
        </nav>
      )}

      {/* On <body>: the header's backdrop blur would trap a fixed overlay. */}
      {sheet &&
        createPortal(
          <div
            className="sh-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
          >
            <div className="sh-sheet-head">
              <Link
                href="/"
                className="sh-brand"
                onClick={() => setSheet(false)}
              >
                <Logo size={26} />
                <span>CanvaRoom</span>
              </Link>
              <button
                className="icon-button"
                aria-label="Close menu"
                onClick={() => setSheet(false)}
                autoFocus
              >
                <Icon name="close" />
              </button>
            </div>
            <nav aria-label="Site" className="sh-sheet-nav">
              {signedIn && (
                <Link href={DASHBOARD} onClick={() => setSheet(false)}>
                  My boards
                </Link>
              )}
              {LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setSheet(false)}
                  aria-current={isCurrent(link.href) ? 'page' : undefined}
                >
                  {link.label}
                </Link>
              ))}
              <p className="sh-sheet-label">Use cases</p>
              {USE_CASES.map((useCase) => (
                <Link
                  key={useCase.slug}
                  href={`/${useCase.slug}`}
                  className="sh-sheet-small"
                  onClick={() => setSheet(false)}
                >
                  {useCase.label}
                </Link>
              ))}
            </nav>
            <div className="sh-sheet-foot">
              {boardActions && (
                <>
                  <button
                    type="button"
                    className="button primary wide"
                    onClick={newBoard}
                  >
                    <Icon name="plus" size={16} strokeWidth={2.2} />
                    New board
                  </button>
                  <button
                    type="button"
                    className="button ghost wide"
                    onClick={joinBoard}
                  >
                    <Icon name="link" size={16} />
                    Join with link
                  </button>
                </>
              )}
              {signedIn ? (
                <>
                  <PlanChip />
                  <Link
                    href="/profile"
                    className="button ghost wide"
                    onClick={() => setSheet(false)}
                  >
                    Profile &amp; settings
                  </Link>
                </>
              ) : (
                <>
                  <Link
                    href="/signup"
                    className="button primary wide"
                    onClick={() => setSheet(false)}
                  >
                    Start free trial
                  </Link>
                  <Link
                    href="/login"
                    className="button ghost wide"
                    onClick={() => setSheet(false)}
                  >
                    Log in
                  </Link>
                </>
              )}
              <ThemeToggle withLabel />
            </div>
          </div>,
          document.body,
        )}
      {joining &&
        createPortal(
          <JoinBoardModal onClose={() => setJoining(false)} />,
          document.body,
        )}
    </header>
  );
}

function UseCasesMenu({ pathname }: { pathname: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, setOpen, ref);
  const current = USE_CASES.some((item) => pathname === `/${item.slug}`);
  return (
    <div className="sh-drop" ref={ref}>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        className={current ? 'is-current' : ''}
        onClick={() => setOpen((value) => !value)}
      >
        Use cases <Icon name="chevronDown" size={14} />
      </button>
      {open && (
        <div className="sh-drop-menu">
          {USE_CASES.map((useCase) => (
            <Link
              key={useCase.slug}
              href={`/${useCase.slug}`}
              aria-current={
                pathname === `/${useCase.slug}` ? 'page' : undefined
              }
              onClick={() => setOpen(false)}
            >
              <strong>{useCase.label}</strong>
              <small>{useCase.kicker}</small>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
