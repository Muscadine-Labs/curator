'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { useClearStuckWalletUi } from '@/lib/hooks/useClearStuckWalletUi';

type AppShellProps = {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Parent route for nested pages (e.g. /markets/create → /markets). */
  backHref?: string;
  backLabel?: string;
  children: ReactNode;
};

export function AppShell({
  title,
  description,
  actions,
  backHref,
  backLabel = 'Back',
  children,
}: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  useClearStuckWalletUi();

  return (
    <div className="min-h-dvh bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div className="flex min-h-dvh">
        {sidebarOpen ? (
          <div
            className="fixed inset-0 z-40 bg-black/50 touch-manipulation lg:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-hidden="true"
          />
        ) : null}

        <aside
          className={`fixed inset-y-0 left-0 z-50 w-[min(100vw-3rem,16rem)] max-w-full transform border-r border-slate-200 bg-white/95 backdrop-blur transition-transform duration-300 ease-in-out dark:border-slate-800 dark:bg-slate-900/95 lg:relative lg:w-64 lg:translate-x-0 ${
            sidebarOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <Sidebar onClose={() => setSidebarOpen(false)} />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="sticky top-0 z-30">
            <Topbar onMenuClick={() => setSidebarOpen(true)} />
          </div>
          <header className="border-b border-slate-200 bg-white/80 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80 sm:px-6 sm:py-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 flex-1 space-y-1">
                {backHref ? (
                  <Link
                    href={backHref}
                    className="inline-flex min-h-9 items-center gap-1 text-xs font-medium text-slate-500 transition-colors hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 sm:text-sm"
                  >
                    <ArrowLeft className="h-3.5 w-3.5 shrink-0" />
                    {backLabel}
                  </Link>
                ) : null}
                <h1 className="break-words text-xl font-semibold text-slate-900 dark:text-slate-100 sm:text-2xl">
                  {title}
                </h1>
                {description ? (
                  <p className="line-clamp-3 text-xs text-slate-500 dark:text-slate-400 sm:line-clamp-none sm:text-sm">
                    {description}
                  </p>
                ) : null}
              </div>
              {actions ? (
                <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
                  {actions}
                </div>
              ) : null}
            </div>
          </header>
          <main
            id="app-main"
            className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-4 pb-[max(3rem,env(safe-area-inset-bottom))] pt-4 sm:px-6 sm:pt-6"
          >
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
