'use client';

import { useCallback } from 'react';
import { useConnection } from 'wagmi';
import { useAppKit } from '@reown/appkit/react';
import { Button } from '@/components/ui/button';
import { useIsClient } from '@/lib/hooks/useIsClient';
import { useWalletDisplayName } from '@/lib/hooks/useWalletDisplayName';
import { cn } from '@/lib/utils';

type ConnectWalletButtonProps = {
  className?: string;
  /** Full-width layout for account sheet / mobile. */
  fullWidth?: boolean;
};

/** Reown AppKit wallet controls (chain status hidden — app network is separate). */
export function ConnectWalletButton({
  className,
  fullWidth = false,
}: ConnectWalletButtonProps) {
  const { open } = useAppKit();
  const { address, isConnected } = useConnection();
  const isClient = useIsClient();
  const { displayName } = useWalletDisplayName(address);

  const handleClick = useCallback(() => {
    void open({ view: isConnected ? 'Account' : 'Connect' });
  }, [isConnected, open]);

  return (
    <Button
      type="button"
      variant={isConnected ? 'outline' : 'default'}
      size={fullWidth ? 'default' : 'sm'}
      onClick={handleClick}
      disabled={!isClient}
      className={cn(
        fullWidth && 'h-11 min-h-[44px] w-full touch-manipulation',
        className
      )}
    >
      {!isClient || !isConnected ? 'Connect Wallet' : displayName}
    </Button>
  );
}
