'use client';

import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import {
  baseAccount,
  metaMaskWallet,
  rabbyWallet,
  rainbowWallet,
  safeWallet,
  walletConnectWallet,
} from '@rainbow-me/rainbowkit/wallets';
import { http } from 'wagmi';
import { arbitrum, avalanche, base, mainnet, optimism, polygon } from 'viem/chains';

// Create wagmi config with RainbowKit
// Allow build-time to proceed without env vars (they'll be required at runtime in production)
// Use 'demo' as fallback during build/development, but should be set in production runtime
const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'demo';

// Base and Rabby as defaults, then other popular wallets
const wallets = [
  {
    groupName: 'Popular',
    wallets: [
      baseAccount,
      rabbyWallet,
      safeWallet,
      rainbowWallet,
      metaMaskWallet,
      walletConnectWallet,
    ],
  },
];

// Supported chains: Base (default), Ethereum, Optimism, Polygon, Arbitrum, Avalanche
// Arbitrum + Avalanche are included so CCTP (Circle Cross-Chain Transfer) works on them.
const chains = [base, mainnet, optimism, polygon, arbitrum, avalanche] as const;

function getRpcUrl(chainId: number): string {
  const alchemyKey = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY;
  const key = alchemyKey || 'demo';

  const rpcMap: Record<number, string> = {
    [base.id]: `https://base-mainnet.g.alchemy.com/v2/${key}`,
    [mainnet.id]: `https://eth-mainnet.g.alchemy.com/v2/${key}`,
    [optimism.id]: `https://opt-mainnet.g.alchemy.com/v2/${key}`,
    [polygon.id]: `https://polygon-mainnet.g.alchemy.com/v2/${key}`,
    [arbitrum.id]: `https://arb-mainnet.g.alchemy.com/v2/${key}`,
    // Alchemy doesn't support Avalanche C-Chain publicly here — fall back to Ava Labs
    [avalanche.id]: 'https://api.avax.network/ext/bc/C/rpc',
  };

  return rpcMap[chainId] || rpcMap[base.id];
}

const config = getDefaultConfig({
  appName: 'Muscadine Curator',
  projectId,
  chains,
  ssr: true,
  wallets,
  transports: {
    [base.id]: http(getRpcUrl(base.id)),
    [mainnet.id]: http(getRpcUrl(mainnet.id)),
    [optimism.id]: http(getRpcUrl(optimism.id)),
    [polygon.id]: http(getRpcUrl(polygon.id)),
    [arbitrum.id]: http(getRpcUrl(arbitrum.id)),
    [avalanche.id]: http(getRpcUrl(avalanche.id)),
  },
  // Disable multi-injected probing so only the active/stored connector is used on reconnect
  multiInjectedProviderDiscovery: false,
});

export { config };
