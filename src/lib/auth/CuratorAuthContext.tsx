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
import {
  clearCuratorAuthCache,
  writeCuratorAuthCache,
} from './curator-auth';

export type UserRole = 'admin' | null;

type CuratorAuthContextValue = {
  isAuthenticated: boolean;
  isReady: boolean;
  role: UserRole;
  login: (username: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => void;
};

const CuratorAuthContext = createContext<CuratorAuthContextValue | null>(null);

export function useCuratorAuth(): CuratorAuthContextValue {
  const ctx = useContext(CuratorAuthContext);
  if (!ctx) {
    throw new Error('useCuratorAuth must be used within CuratorAuthProvider');
  }
  return ctx;
}

export function CuratorAuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [role, setRole] = useState<UserRole>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store' });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok && data?.ok === true && data?.role === 'admin') {
          writeCuratorAuthCache('admin');
          setIsAuthenticated(true);
          setRole('admin');
        } else {
          clearCuratorAuthCache();
          setIsAuthenticated(false);
          setRole(null);
        }
      } catch {
        if (!cancelled) {
          clearCuratorAuthCache();
          setIsAuthenticated(false);
          setRole(null);
        }
      } finally {
        if (!cancelled) setIsReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(
    async (username: string, password: string): Promise<{ ok: boolean; error?: string }> => {
      const res = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.ok === true && data?.role === 'admin') {
        writeCuratorAuthCache('admin');
        setIsAuthenticated(true);
        setRole(data.role);
        return { ok: true };
      }
      return { ok: false, error: (data?.error as string) || 'Invalid username or password' };
    },
    []
  );

  const logout = useCallback(() => {
    void fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    clearCuratorAuthCache();
    setIsAuthenticated(false);
    setRole(null);
  }, []);

  const value = useMemo<CuratorAuthContextValue>(
    () => ({ isAuthenticated, isReady, role, login, logout }),
    [isAuthenticated, isReady, role, login, logout]
  );

  return (
    <CuratorAuthContext.Provider value={value}>
      {children}
    </CuratorAuthContext.Provider>
  );
}
