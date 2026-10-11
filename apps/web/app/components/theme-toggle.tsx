'use client';

import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark' | 'system';
const sequence: Theme[] = ['light', 'dark', 'system'];

function apply(theme: Theme) {
  const isDark =
    theme === 'dark' ||
    (theme === 'system' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', isDark);
  document.documentElement.classList.toggle('light', theme === 'light');
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('system');

  useEffect(() => {
    const saved = localStorage.getItem('canvasroom.theme') as Theme | null;
    const preference = saved && sequence.includes(saved) ? saved : 'system';
    setTheme(preference);
    apply(preference);
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const syncSystem = () => {
      if ((localStorage.getItem('canvasroom.theme') ?? 'system') === 'system')
        apply('system');
    };
    media.addEventListener('change', syncSystem);
    return () => media.removeEventListener('change', syncSystem);
  }, []);

  function cycleTheme() {
    const next = sequence[(sequence.indexOf(theme) + 1) % sequence.length]!;
    setTheme(next);
    localStorage.setItem('canvasroom.theme', next);
    apply(next);
  }

  return (
    <button
      className="icon-button theme-button"
      aria-label={`Theme: ${theme}. Change theme`}
      title={`Theme: ${theme} · click to change`}
      onClick={cycleTheme}
    >
      ◐
    </button>
  );
}
