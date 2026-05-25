'use client';

import { useState } from 'react';
import { useCuratorAuth } from '@/lib/auth/CuratorAuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ThemeSwitcher } from '@/components/ThemeSwitcher';

type AuthGuardProps = {
  children: React.ReactNode;
};

export function AuthGuard({ children }: AuthGuardProps) {
  const { isReady, isAuthenticated, role, login } = useCuratorAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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

  if (!isReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-blue-600 dark:border-slate-600 dark:border-t-blue-400" />
      </div>
    );
  }

  // Not authenticated: show sign-in page
  if (!isAuthenticated) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 dark:bg-slate-950">
        <div className="w-full max-w-sm space-y-6 rounded-xl border border-slate-200 bg-white p-6 shadow-lg dark:border-slate-800 dark:bg-slate-900">
          <div className="text-center">
            <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
              Muscadine Curator
            </h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Sign in to access the site
            </p>
          </div>
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
      </div>
    );
  }

  // Authenticated but not Owner: access denied
  if (role !== 'owner') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 dark:bg-slate-950">
        <div className="w-full max-w-sm space-y-6 rounded-xl border border-slate-200 bg-white p-6 shadow-lg dark:border-slate-800 dark:bg-slate-900">
          <div className="text-center">
            <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
              Access Denied
            </h1>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              Owner role is required for full access to this site.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
