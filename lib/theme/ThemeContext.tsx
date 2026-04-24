'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type Theme = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'curator-theme';
const DEFAULT_THEME: Theme = 'system';
const VALID_THEMES: ReadonlyArray<Theme> = ['light', 'dark', 'system'];
// Theme value that was removed but may still be persisted in older browsers.
const LEGACY_THEMES: ReadonlyArray<string> = ['y2k'];

function isTheme(v: string | null): v is Theme {
  return v !== null && (VALID_THEMES as ReadonlyArray<string>).includes(v);
}

function getStored(): Theme {
  if (typeof window === 'undefined') return DEFAULT_THEME;
  const v = localStorage.getItem(STORAGE_KEY);
  // Silently migrate old Y2K users back to system so they aren't stuck on a
  // theme class name that no longer resolves to anything.
  if (v !== null && LEGACY_THEMES.includes(v)) {
    localStorage.setItem(STORAGE_KEY, DEFAULT_THEME);
    return DEFAULT_THEME;
  }
  return isTheme(v) ? v : DEFAULT_THEME;
}

function resolveSystem(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function apply(theme: Theme) {
  const root = document.documentElement;
  root.classList.remove('dark', 'y2k');
  const resolved = theme === 'system' ? resolveSystem() : theme;
  if (resolved === 'dark') {
    root.classList.add('dark');
  }
}

type ThemeContextValue = {
  theme: Theme;
  setTheme: (t: Theme) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => getStored());

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    localStorage.setItem(STORAGE_KEY, t);
    apply(t);
  }, []);

  useEffect(() => {
    apply(theme);
  }, [theme]);

  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => apply('system');
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
