'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../lib/auth';
import { Icon } from './icons';
import { ThemeToggle } from './theme-toggle';

export function Avatar({
  name,
  color,
  size = 32,
}: {
  name: string;
  color: string;
  size?: number;
}) {
  return (
    <span
      className="profile-avatar"
      style={{
        background: color,
        width: size,
        height: size,
        fontSize: size * 0.42,
      }}
      aria-hidden="true"
    >
      {name.trim()[0]?.toUpperCase() ?? '?'}
    </span>
  );
}

/** Closes a popover on outside pointerdown or Escape. */
export function useDismiss(
  open: boolean,
  setOpen: (open: boolean) => void,
  ref: React.RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent && event.key !== 'Escape') return;
      if (
        event instanceof PointerEvent &&
        ref.current?.contains(event.target as Node)
      )
        return;
      setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', close);
    };
  }, [open, setOpen, ref]);
}

/** Avatar button with profile, account, and sign-out actions. */
export function UserMenu({
  variant = 'avatar',
  placement = 'below',
}: {
  /** `row` shows the name next to the avatar, for sidebars. */
  variant?: 'avatar' | 'row';
  placement?: 'below' | 'above';
}) {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  useDismiss(open, setOpen, menu);

  if (!user) return null;
  return (
    <div className={`user-menu user-menu-${variant}`} ref={menu}>
      <button
        className="user-menu-button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        title={user.name}
      >
        <Avatar name={user.name} color={user.color} size={30} />
        {variant === 'row' && (
          <>
            <span className="user-menu-name">
              <strong>{user.name}</strong>
              <small>{user.guest ? 'Guest pass' : user.email}</small>
            </span>
            <Icon name="chevronDown" size={16} />
          </>
        )}
      </button>
      {open && (
        <div className={`popover user-menu-panel ${placement}`} role="menu">
          <div className="user-menu-head">
            <Avatar name={user.name} color={user.color} size={38} />
            <div>
              <strong>{user.name}</strong>
              <small>{user.guest ? 'Guest' : user.email}</small>
            </div>
          </div>
          {user.guest ? (
            <Link
              className="menu-row"
              role="menuitem"
              href="/?mode=signup"
              onClick={() => setOpen(false)}
            >
              <Icon name="sparkle" />
              <span>Create an account</span>
            </Link>
          ) : (
            <Link
              className="menu-row"
              role="menuitem"
              href="/profile"
              onClick={() => setOpen(false)}
            >
              <Icon name="user" />
              <span>Profile &amp; settings</span>
            </Link>
          )}
          <Link
            className="menu-row"
            role="menuitem"
            href="/"
            onClick={() => setOpen(false)}
          >
            <Icon name="grid" />
            <span>All boards</span>
          </Link>
          <ThemeToggle withLabel />
          <div className="menu-divider" />
          <button
            className="menu-row danger"
            role="menuitem"
            onClick={async () => {
              setOpen(false);
              await signOut();
              router.push('/');
            }}
          >
            <Icon name="logout" />
            <span>Sign out</span>
          </button>
        </div>
      )}
    </div>
  );
}
