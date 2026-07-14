'use client';

import { ConnectButton } from '@rainbow-me/rainbowkit';

type ConnectWalletButtonProps = {
  className?: string;
};

/** RainbowKit wallet + network controls for the top bar. */
export function ConnectWalletButton({ className }: ConnectWalletButtonProps) {
  return (
    <div className={className}>
      <ConnectButton showBalance={false} chainStatus="none" accountStatus="address" />
    </div>
  );
}
