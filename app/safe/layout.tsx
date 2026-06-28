'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { MuscadineSafeWorkspaceCard } from '@/components/safe/MuscadineSafeWorkspaceCard';
import { SafeAppModeBanner } from '@/lib/safe/safe-apps-context';
import { SAFE_ACCOUNTS, type SafeRole } from '@/lib/safe/config';
import { useSafePendingCount } from '@/lib/hooks/useSafePending';
import { cn } from '@/lib/utils';

function SafeTabLink({ role, label }: { role: SafeRole; label: string }) {
  const pathname = usePathname();
  const href = `/safe/${role}`;
  const active = pathname === href || pathname.startsWith(`${href}/`);
  const pendingCount = useSafePendingCount(role);

  return (
    <Link
      href={href}
      className={cn(
        'inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium transition touch-manipulation',
        active
          ? 'border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900'
          : 'border-transparent bg-muted text-muted-foreground hover:bg-slate-100 dark:hover:bg-slate-800'
      )}
    >
      {label}
      {pendingCount > 0 && (
        <span
          className={cn(
            'rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums',
            active
              ? 'bg-white/20 text-white dark:bg-slate-900/20 dark:text-slate-900'
              : 'bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300'
          )}
        >
          {pendingCount}
        </span>
      )}
    </Link>
  );
}

export default function SafeLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell
      title="Multisig Safe"
      description="Muscadine Labs Safes on Base — view multisigs, sign queued vault transactions, and open the Safe workspace."
    >
      <div className="space-y-6">
        <SafeAppModeBanner />
        <MuscadineSafeWorkspaceCard />
        <nav className="flex flex-wrap gap-2">
          {SAFE_ACCOUNTS.map((account) => (
            <SafeTabLink key={account.role} role={account.role} label={account.label} />
          ))}
        </nav>
        {children}
      </div>
    </AppShell>
  );
}
