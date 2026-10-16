'use client';

import { useEffect, useState } from 'react';
import { Icon } from './icons';

type Theme = 'light' | 'dark' | 'system';
const sequence: Theme[] = ['light', 'dark', 'system'];
const ICONS = { light: 'sun', dark: 'moon', system: 'monitor' } as const;

function apply(theme: Theme) {
  const isDark =
    theme === 'dark' ||
    (theme === 'system' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', isDark);
  document.documentElement.classList.toggle('light', theme === 'light');
}

function readTheme(): Theme {
  try {
    const saved = localStorage.getItem('canvasroom.theme') as Theme | null;
    return saved && sequence.includes(saved) ? saved : 'system';
  } catch {
    return 'system';
  }
}

export function ThemeToggle({ withLabel = false }: { withLabel?: boolean }) {
  const [theme, setTheme] = useState<Theme>('system');

  useEffect(() => {
    const preference = readTheme();
    setTheme(preference);
    apply(preference);
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const syncSystem = () => {
      if (readTheme() === 'system') apply('system');
    };
    media.addEventListener('change', syncSystem);
    return () => media.removeEventListener('change', syncSystem);
  }, []);

  function cycleTheme() {
    const next = sequence[(sequence.indexOf(theme) + 1) % sequence.length]!;
    setTheme(next);
    try {
      localStorage.setItem('canvasroom.theme', next);
    } catch {
      // The choice still applies to this page.
    }
    apply(next);
  }

  const label = theme[0]!.toUpperCase() + theme.slice(1);
  return (
    <button
      className={withLabel ? 'menu-row' : 'icon-button'}
      aria-label={`Theme: ${theme}. Change theme`}
      title={`Theme: ${theme}`}
      onClick={cycleTheme}
    >
      <Icon name={ICONS[theme]} />
      {withLabel && (
        <>
          <span>Theme</span>
          <span className="menu-row-hint">{label}</span>
        </>
      )}
    </button>
  );
}
