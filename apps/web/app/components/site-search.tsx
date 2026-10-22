'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { api, type BoardListItem } from '../lib/api';
import { useAuth } from '../lib/auth';
import { BOARD_NAV } from '../lib/navigation';
import { DASHBOARD } from '../lib/next-url';
import { HOME_FAQ, USE_CASES } from '../lib/site';
import { Icon, type IconName } from './icons';

type Group = 'Pages' | 'Library' | 'Your boards';
type Result = {
  group: Group;
  title: string;
  hint: string;
  href: string;
  icon: IconName;
  /** Extra words that should match but aren't shown. */
  words?: string | undefined;
};

const GROUPS: Group[] = ['Pages', 'Your boards', 'Library'];

/** Every page and section a visitor can reach, plus the FAQ. */
const PAGES: Result[] = (
  [
    { title: 'Home', hint: 'The landing page', href: '/', icon: 'home' },
    {
      title: 'Features',
      hint: 'Live ink, voice, follow the writer, recording',
      href: '/#features',
      icon: 'sparkle',
      words:
        'live ink voice chat follow writer locator shapes templates pages zoom qr invite recording export history dark mode',
    },
    {
      title: 'Pricing',
      hint: 'Free trial, free plan and Premium',
      href: '/#pricing',
      icon: 'sparkle',
      words:
        'plans premium upgrade price cost trial free monthly dollars usd',
    },
    {
      title: 'Library',
      hint: 'Formula and table packs for teaching',
      href: '/library',
      icon: 'library',
      words: 'formulas maths periodic table trigonometry calculus physics',
    },
    {
      title: 'About us',
      hint: 'Why CanvaRoom exists',
      href: '/about',
      icon: 'users',
    },
    {
      title: 'Contact us',
      hint: 'Email the team or send feedback',
      href: '/contact',
      icon: 'inbox',
      words: 'email support help feedback',
    },
    {
      title: 'Log in',
      hint: 'Sign in to your boards',
      href: '/login',
      icon: 'user',
      words: 'sign in',
    },
    {
      title: 'Start free trial',
      hint: 'Create an account',
      href: '/signup',
      icon: 'plus',
      words: 'sign up register account',
    },
    {
      title: 'My boards',
      hint: 'Your dashboard',
      href: DASHBOARD,
      icon: 'grid',
      words: 'dashboard boards',
    },
    ...USE_CASES.map((useCase) => ({
      title: useCase.label,
      hint: useCase.kicker,
      href: `/${useCase.slug}`,
      icon: 'pen' as IconName,
      words: useCase.description,
    })),
    ...HOME_FAQ.map((faq) => ({
      title: faq.q,
      hint: 'FAQ',
      href: '/#faq',
      icon: 'help' as IconName,
      words: faq.a,
    })),
  ] as Omit<Result, 'group'>[]
).map((result) => ({ ...result, group: 'Pages' as const }));

type PackIndex = {
  packs: { id: string; title: string; subject: string; description: string }[];
};
type PackFile = { items: { id: string; title: string; keywords?: string }[] };

let libraryIndex: Promise<Result[]> | undefined;
/** Library packs and their items, fetched once, the first time it's needed. */
function loadLibrary() {
  libraryIndex ??= (async () => {
    const index = (await (
      await fetch('/library/v1/index.json')
    ).json()) as PackIndex;
    const packs = await Promise.all(
      index.packs.map(async (pack) => {
        const head: Result = {
          group: 'Library',
          title: pack.title,
          hint: `${pack.subject} pack`,
          href: `/library?q=${encodeURIComponent(pack.title)}`,
          icon: 'library',
          words: pack.description,
        };
        try {
          const file = (await (
            await fetch(`/library/v1/${pack.id}/pack.json`)
          ).json()) as PackFile;
          return [
            head,
            ...file.items.map((item): Result => ({
              group: 'Library',
              title: item.title,
              hint: pack.title,
              href: `/library?q=${encodeURIComponent(item.title)}`,
              icon: 'library',
              words: item.keywords,
            })),
          ];
        } catch {
          return [head];
        }
      }),
    );
    return packs.flat();
  })().catch(() => {
    libraryIndex = undefined;
    return [];
  });
  return libraryIndex;
}

function score(result: Result, terms: string[]) {
  const title = result.title.toLowerCase();
  const rest = `${result.hint} ${result.words ?? ''}`.toLowerCase();
  let total = 0;
  for (const term of terms) {
    if (title.startsWith(term)) total += 6;
    else if (title.includes(term)) total += 4;
    else if (rest.includes(term)) total += 1;
    else return 0;
  }
  return total;
}

/**
 * The header's search: pages, FAQ, library packs and items, and, when signed
 * in, the person's own boards. The library and boards load on first focus.
 */
export function SiteSearch({
  autoFocus = false,
  onNavigate,
}: {
  autoFocus?: boolean;
  /** Called after a result is opened, e.g. to close the mobile sheet. */
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const { user } = useAuth();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [library, setLibrary] = useState<Result[]>([]);
  const [boards, setBoards] = useState<Result[]>([]);
  const loaded = useRef({ library: false, boards: '' });

  function warm() {
    if (!loaded.current.library) {
      loaded.current.library = true;
      void loadLibrary().then(setLibrary);
    }
    if (user && !user.guest && loaded.current.boards !== user.id) {
      loaded.current.boards = user.id;
      api<BoardListItem[]>('/boards')
        .then((list) =>
          setBoards(
            list.map((board) => ({
              group: 'Your boards',
              title: board.title,
              hint: board.role === 'owner' ? 'Your board' : 'Shared with you',
              href: `/board/${board.id}`,
              icon: 'grid',
            })),
          ),
        )
        .catch(() => setBoards([]));
    }
  }

  // Cmd/Ctrl+K anywhere, or "/" when not typing, jumps to the search.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing =
        event.target instanceof HTMLElement &&
        (event.target.isContentEditable ||
          /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName));
      if (
        (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) ||
        (event.key === '/' && !typing && !event.metaKey && !event.ctrlKey)
      ) {
        const field = input.current;
        // Two headers can exist (desktop and mobile); use the visible one.
        if (!field || field.offsetParent === null) return;
        event.preventDefault();
        field.focus();
        field.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);

  const results = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    const signedIn = Boolean(user && !user.guest);
    const pages = PAGES.filter((page) =>
      signedIn
        ? page.href !== '/login' && page.href !== '/signup'
        : page.href !== DASHBOARD,
    );
    const ranked = [...pages, ...boards, ...library]
      .map((result) => ({ result, score: score(result, terms) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score);
    // A few of each kind, so one group can't crowd out the others.
    return GROUPS.flatMap((group) =>
      ranked
        .filter((entry) => entry.result.group === group)
        .slice(0, group === 'Library' ? 6 : 5)
        .map((entry) => entry.result),
    );
  }, [query, boards, library, user]);

  function go(result: Result) {
    setOpen(false);
    setQuery('');
    input.current?.blur();
    onNavigate?.();
    if (result.href.startsWith('/board/')) router.push(result.href, BOARD_NAV);
    else router.push(result.href);
  }

  const showList = open && query.trim().length > 0;
  const listId = `${id}-results`;

  return (
    <div className="site-search" ref={box}>
      <Icon name="search" size={17} />
      <input
        ref={input}
        type="search"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={
          showList && results[active] ? `${id}-r${active}` : undefined
        }
        aria-label="Search CanvaRoom"
        placeholder="Search pages, formulas, your boards…"
        value={query}
        autoFocus={autoFocus}
        onFocus={() => {
          warm();
          setOpen(true);
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActive((index) => Math.min(index + 1, results.length - 1));
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActive((index) => Math.max(index - 1, 0));
          } else if (event.key === 'Enter' && results[active]) {
            event.preventDefault();
            go(results[active]);
          } else if (event.key === 'Escape') {
            if (query) setQuery('');
            else input.current?.blur();
            setOpen(false);
          }
        }}
      />
      <kbd className="site-search-key" aria-hidden="true">
        ⌘K
      </kbd>
      {showList && (
        <div className="site-search-list" id={listId} role="listbox">
          {results.length === 0 ? (
            <p className="site-search-empty">
              Nothing matches “{query.trim()}”.
            </p>
          ) : (
            GROUPS.map((group) => {
              const inGroup = results
                .map((result, index) => ({ result, index }))
                .filter((entry) => entry.result.group === group);
              if (!inGroup.length) return null;
              return (
                <div key={group} role="group" aria-label={group}>
                  <p className="site-search-group">{group}</p>
                  {inGroup.map(({ result, index }) => (
                    <div
                      key={`${result.href}-${result.title}`}
                      id={`${id}-r${index}`}
                      role="option"
                      aria-selected={index === active}
                      className="site-search-row"
                      onPointerEnter={() => setActive(index)}
                      onPointerDown={(event) => event.preventDefault()}
                      onClick={() => go(result)}
                    >
                      <Icon name={result.icon} size={16} />
                      <span>
                        <strong>{result.title}</strong>
                        <small>{result.hint}</small>
                      </span>
                    </div>
                  ))}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
