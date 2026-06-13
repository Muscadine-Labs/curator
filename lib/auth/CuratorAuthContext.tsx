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
  isCuratorAuthCacheValid,
  readCuratorAuthCache,
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
    const cache = readCuratorAuthCache();
    if (isCuratorAuthCacheValid(cache)) {
      // cache is guaranteed to be non-null if isCuratorAuthCacheValid returns true
      setIsAuthenticated(true);
      setRole(cache!.role);
    } else {
      if (cache) clearCuratorAuthCache();
      setIsAuthenticated(false);
      setRole(null);
    }
    setIsReady(true);
  }, []);

  const login = useCallback(
    async (username: string, password: string): Promise<{ ok: boolean; error?: string }> => {
      const res = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
