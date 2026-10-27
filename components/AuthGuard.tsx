'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { useCuratorAuth } from '@/lib/auth/CuratorAuthContext';
import { isTestingVaultPage, isVaultSentinelPage } from '@/lib/auth/public-read';
import { resolveCuratorNavArea } from '@/lib/nav/areas';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ThemeSwitcher } from '@/components/ThemeSwitcher';

type AuthGuardProps = {
  children: React.ReactNode;
};

function lockCopy(pathname: string): string | null {
  if (isTestingVaultPage(pathname)) {
    return 'Testing vaults are available after you sign in.';
  }
  if (isVaultSentinelPage(pathname)) {
    return 'Sentinel is available after you sign in.';
  }
  const area = resolveCuratorNavArea(pathname);
  if (area === 'curator' || area === 'business') {
    return 'Curator and Business are available after you sign in.';
  }
  return null;
}

export function AuthGuard({ children }: AuthGuardProps) {
  const pathname = usePathname();
  const { isReady, isAuthenticated, role, login } = useCuratorAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const lockedMessage = lockCopy(pathname);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const result = await login(username, password);
    setLoading(false);
    if (!result.ok) {
      setError(result.error ?? 'Invalid username or password');
    }
  };

  if (lockedMessage && !isReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-blue-600 dark:border-slate-600 dark:border-t-blue-400" />
      </div>
    );
  }

  if (lockedMessage && !isAuthenticated) {
    return (
      <AppShell title="Sign in" description={lockedMessage}>
        <div className="mx-auto w-full max-w-sm space-y-6 rounded-xl border border-slate-200 bg-white p-6 shadow-lg dark:border-slate-800 dark:bg-slate-900">
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              type="text"
              placeholder="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={loading}
              autoComplete="username"
              className="h-11"
            />
            <Input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              autoComplete="current-password"
              className="h-11"
            />
            {error && (
              <p className="text-sm text-red-600 dark:text-red-400" role="alert">
                {error}
              </p>
            )}
            <Button
              type="submit"
              className="h-11 w-full"
              disabled={loading || !username.trim() || !password.trim()}
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
          <div className="border-t border-slate-200 pt-4 dark:border-slate-700">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              Appearance
            </p>
            <ThemeSwitcher />
          </div>
        </div>
      </AppShell>
    );
  }

  if (isAuthenticated && role !== 'admin') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 dark:bg-slate-950">
        <div className="w-full max-w-sm space-y-6 rounded-xl border border-slate-200 bg-white p-6 shadow-lg dark:border-slate-800 dark:bg-slate-900">
          <div className="text-center">
            <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
              Access Denied
            </h1>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              Admin role is required for full access to this site.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
