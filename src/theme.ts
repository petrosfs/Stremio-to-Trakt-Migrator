import { useCallback, useEffect, useState } from 'react';
import { load, save } from './lib/storage';

export type Theme = 'system' | 'light' | 'dark';
const ORDER: Theme[] = ['system', 'light', 'dark'];

function systemDark(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

export function applyTheme(theme: Theme) {
  const dark = theme === 'dark' || (theme === 'system' && systemDark());
  document.documentElement.classList.toggle('dark', dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#020617' : '#0f172a');
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    const t = load<Theme>('theme');
    return t && ORDER.includes(t) ? t : 'system';
  });

  useEffect(() => {
    applyTheme(theme);
    save('theme', theme);
    if (theme !== 'system') return;
    let mq: MediaQueryList | null = null;
    try {
      mq = window.matchMedia('(prefers-color-scheme: dark)');
    } catch {
      return;
    }
    const onChange = () => applyTheme('system');
    mq.addEventListener('change', onChange);
    return () => mq?.removeEventListener('change', onChange);
  }, [theme]);

  const cycle = useCallback(() => setTheme((t) => ORDER[(ORDER.indexOf(t) + 1) % ORDER.length]), []);
  return { theme, setTheme, cycle };
}
