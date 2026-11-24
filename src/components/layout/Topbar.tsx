'use client';

import { Menu, UserRound } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { SignInSheet } from '@/components/SignInSheet';
import { useCuratorAuth } from '@/lib/auth/CuratorAuthContext';
import { useCuratorNetwork } from '@/lib/network/CuratorNetworkContext';
import { Button } from '@/components/ui/button';
import { CURATOR_TOP_NAV, isTopNavActive } from '@/lib/nav/areas';
import { cn } from '@/lib/utils';

type TopbarProps = {
  onMenuClick?: () => void;
};

export function Topbar({ onMenuClick }: TopbarProps) {
  const { isAuthenticated } = useCuratorAuth();
  const { networkName, isWalletOnSelectedChain } = useCuratorNetwork();
  const [sheetOpen, setSheetOpen] = useState(false);
  const pathname = usePathname();

  return (
    <>
      <div className="relative z-10 flex items-center gap-2 border-b border-slate-200 bg-white/70 px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] backdrop-blur dark:border-slate-800 dark:bg-slate-900/70 sm:gap-3 sm:px-6 sm:py-3">
        {onMenuClick ? (
          <Button
            variant="ghost"
            size="icon"
            className="min-h-[44px] min-w-[44px] shrink-0 touch-manipulation lg:hidden"
            onClick={onMenuClick}
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </Button>
        ) : null}

        <nav
          className="-mx-1 flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto px-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          aria-label="Primary"
        >
          {CURATOR_TOP_NAV.map((item) => {
            const active = isTopNavActive(item.id, pathname);
            return (
              <Link
                key={item.id}
                href={item.href}
                className={cn(
                  'shrink-0 rounded-md px-2.5 py-2 text-xs font-medium transition sm:px-3 sm:text-sm',
                  active
                    ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100'
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <Button
          variant={isAuthenticated ? 'outline' : 'default'}
          size="sm"
          className="min-h-10 shrink-0 touch-manipulation gap-1.5 px-2.5 sm:px-3"
          onClick={() => setSheetOpen(true)}
          aria-label="Account"
        >
          <UserRound className="h-4 w-4 shrink-0" />
          <span>Account</span>
          <span
            className={cn(
              'max-w-[3.75rem] truncate text-[10px] font-normal sm:max-w-[6rem] sm:text-xs',
              !isWalletOnSelectedChain
                ? 'text-amber-700 dark:text-amber-400'
                : isAuthenticated
                  ? 'opacity-80'
                  : 'text-primary-foreground/80'
            )}
            title={networkName}
          >
            {networkName}
          </span>
        </Button>
      </div>
      <SignInSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
    </>
  );
}
