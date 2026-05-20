'use client';

import { AppKitButton } from '@reown/appkit/react';

type ConnectWalletButtonProps = {
  className?: string;
};

/** Reown AppKit connect / account button (replaces RainbowKit ConnectButton). */
export function ConnectWalletButton({ className }: ConnectWalletButtonProps) {
  return <AppKitButton className={className} />;
}
