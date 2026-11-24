'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { SafeRole } from '@/lib/safe/config';
import { useSafePendingCount } from '@/lib/hooks/useSafePending';
import { cn } from '@/lib/utils';

const SECTIONS = [
  { segment: '', label: 'Home' },
  { segment: 'assets', label: 'Assets' },
  { segment: 'transactions', label: 'Transactions' },
  { segment: 'history', label: 'History' },
  { segment: 'settings', label: 'Settings' },
] as const;

export function SafeRoleSubnav({ role }: { role: SafeRole }) {
  const pathname = usePathname();
  const pendingCount = useSafePendingCount(role);
  const base = `/safe/${role}`;

  return (
    <nav className="flex flex-wrap items-center gap-4 border-b border-border">
      {SECTIONS.map(({ segment, label }) => {
        const href = segment ? `${base}/${segment}` : base;
        const active = pathname === href;
        const badge = segment === 'transactions' ? pendingCount : 0;
        return (
          <Link
            key={label}
            href={href}
            className={cn(
              '-mb-px inline-flex items-center gap-1.5 border-b-2 px-0.5 pb-2 text-sm font-medium transition',
              active
                ? 'border-foreground text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {label}
            {badge > 0 ? (
              <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-blue-800 dark:bg-blue-950/50 dark:text-blue-300">
                {badge}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
