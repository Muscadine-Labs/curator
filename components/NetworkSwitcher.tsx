'use client';

import { AppKitNetworkButton } from '@reown/appkit/react';

type NetworkSwitcherProps = {
  className?: string;
};

/** Opens Reown AppKit network picker (Base, Ethereum, Arbitrum, etc.). */
export function NetworkSwitcher({ className }: NetworkSwitcherProps) {
  return <AppKitNetworkButton className={className} />;
}
