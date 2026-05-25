'use client';

import { useCallback, useEffect, useState } from 'react';
import { ThemeSwitcher } from '@/components/ThemeSwitcher';
import { useCuratorAuth } from '@/lib/auth/CuratorAuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { X } from 'lucide-react';

type SignInSheetProps = {
  open: boolean;
  onClose: () => void;
};

export function SignInSheet({ open, onClose }: SignInSheetProps) {
  const { isAuthenticated, login, logout } = useCuratorAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showSignInForm, setShowSignInForm] = useState(false);

  const reset = useCallback(() => {
    setUsername('');
    setPassword('');
    setError(null);
    setLoading(false);
    setShowSignInForm(false);
  }, []);

  useEffect(() => {
    if (open) reset();
  }, [open, reset]);

  const handleLogout = () => {
    logout();
    onClose();
  };

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const result = await login(username, password);
    setLoading(false);
    if (result.ok) {
      onClose();
    } else {
      setError(result.error ?? 'Invalid username or password');
    }
  };

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-50 bg-black/30 backdrop-blur-[2px] transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className="fixed left-4 right-4 top-4 z-50 flex max-h-[min(calc(100vh-5rem),420px)] w-auto flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900 sm:left-auto sm:right-4 sm:w-[380px]"
        role="dialog"
        aria-modal="true"
        aria-label={isAuthenticated ? 'Account' : 'Sign in'}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            {isAuthenticated ? 'Account' : 'Sign in'}
          </h2>
          <Button
            variant="ghost"
            size="icon"
            className="-mr-1 h-11 w-11 touch-manipulation sm:h-8 sm:w-8"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="flex flex-col gap-5">
            {isAuthenticated ? (
              <div className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  Session
                </p>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 min-h-[44px] w-full touch-manipulation rounded-lg border-red-200 text-red-700 hover:border-red-300 hover:bg-red-50"
                  onClick={handleLogout}
                >
                  Log out
                </Button>
              </div>
            ) : showSignInForm ? (
              <div className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  Sign In
                </p>
                <form onSubmit={handleSubmit} className="space-y-2">
                  <Input
                    type="text"
                    placeholder="Username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    disabled={loading}
                    autoComplete="username"
                    className="h-11 min-h-[44px] touch-manipulation rounded-lg border-slate-200"
                  />
                  <Input
                    type="password"
                    placeholder="Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={loading}
                    autoComplete="current-password"
                    className="h-11 min-h-[44px] touch-manipulation rounded-lg border-slate-200"
                  />
                  {error && (
                    <p className="text-sm text-red-600" role="alert">
                      {error}
                    </p>
                  )}
                  <Button
                    type="submit"
                    className="h-11 min-h-[44px] w-full touch-manipulation rounded-lg"
                    disabled={loading || !username.trim() || !password.trim()}
                  >
                    {loading ? 'Checking…' : 'Sign in'}
                  </Button>
                </form>
              </div>
            ) : (
              <Button
                type="button"
                className="h-11 min-h-[44px] w-full touch-manipulation rounded-lg"
                onClick={() => setShowSignInForm(true)}
              >
                Sign in
              </Button>
            )}

            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                Appearance
              </p>
              <ThemeSwitcher />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
