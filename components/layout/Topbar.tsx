'use client';

import { useState } from 'react';
import { Menu } from 'lucide-react';
import { NetworkSwitcher } from '@/components/NetworkSwitcher';
import { SignInSheet } from '@/components/SignInSheet';
import { useCuratorAuth } from '@/lib/auth/CuratorAuthContext';
import { Button } from '@/components/ui/button';

type TopbarProps = {
  onMenuClick?: () => void;
};

export function Topbar({ onMenuClick }: TopbarProps) {
  const { isAuthenticated } = useCuratorAuth();
  const [sheetOpen, setSheetOpen] = useState(false);

  return (
    <>
      <div className="relative z-10 flex items-center justify-between border-b border-slate-200 bg-white/70 px-4 py-2 backdrop-blur dark:border-slate-800 dark:bg-slate-900/70 sm:px-6 sm:py-3">
        <div className="flex items-center gap-3">
          {onMenuClick && (
            <Button
              variant="ghost"
              size="icon"
              className="min-h-[44px] min-w-[44px] touch-manipulation lg:hidden"
              onClick={onMenuClick}
            >
              <Menu className="h-5 w-5" />
            </Button>
          )}
          <div className="text-xs font-medium text-slate-600 dark:text-slate-400 sm:text-sm">Muscadine Curator</div>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <NetworkSwitcher />
          <Button
            variant={isAuthenticated ? 'outline' : 'default'}
            size="sm"
            className="min-h-10 touch-manipulation"
            onClick={() => setSheetOpen(true)}
          >
            {isAuthenticated ? 'Account' : 'Sign in'}
          </Button>
        </div>
      </div>
      <SignInSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
    </>
  );
}
