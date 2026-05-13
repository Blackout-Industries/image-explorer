import { useState, useEffect, useCallback } from 'react';

export type Theme =
  | 'mocha'
  | 'latte'
  | 'ayu-dark'
  | 'gruvbox-dark'
  | 'nord'
  | 'half-life';

const STORAGE_KEY = 'image-explorer-theme';

const VALID: ReadonlySet<Theme> = new Set<Theme>([
  'mocha',
  'latte',
  'ayu-dark',
  'gruvbox-dark',
  'nord',
  'half-life',
]);

function getInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return 'mocha';
    if (stored === 'dark') return 'mocha';
    if (stored === 'light') return 'latte';
    if (VALID.has(stored as Theme)) return stored as Theme;
  } catch {
    // localStorage unavailable
  }
  return 'mocha';
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // localStorage unavailable
    }
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState(prev => {
      const list: Theme[] = [
        'mocha',
        'latte',
        'ayu-dark',
        'gruvbox-dark',
        'nord',
        'half-life',
      ];
      const idx = list.indexOf(prev);
      return list[(idx + 1) % list.length]!;
    });
  }, []);

  return { theme, setTheme, toggleTheme } as const;
}
