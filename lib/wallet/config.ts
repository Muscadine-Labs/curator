import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import {
  base as baseWallet,
  metaMaskWallet,
  phantomWallet,
  rabbyWallet,
  walletConnectWallet,
} from '@rainbow-me/rainbowkit/wallets';
import { http } from 'wagmi';
import {
  arbitrum,
  avalanche,
  base,
  mainnet,
  optimism,
  polygon,
} from 'wagmi/chains';
import { defineChain } from 'viem';

export const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'demo';

export const hyperEvm = defineChain({
  id: 999,
  name: 'HyperEVM',
  nativeCurrency: { name: 'HYPE', symbol: 'HYPE', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.hyperliquid.xyz/evm'] },
  },
  blockExplorers: {
    default: { name: 'HyperEVMScan', url: 'https://hyperevmscan.io' },
  },
  contracts: {
    multicall3: {
      address: '0xcA11bde05977b3631167028862bE2a173976CA11',
      blockCreated: 13051,
    },
  },
});

export const chains = [
  base,
  mainnet,
  optimism,
  polygon,
  arbitrum,
  avalanche,
  hyperEvm,
] as const;

function getRpcUrl(chainId: number): string {
  const alchemyKey = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY;
  const key = alchemyKey || 'demo';

  const rpcMap: Record<number, string> = {
    [base.id]: `https://base-mainnet.g.alchemy.com/v2/${key}`,
    [mainnet.id]: `https://eth-mainnet.g.alchemy.com/v2/${key}`,
    [optimism.id]: `https://opt-mainnet.g.alchemy.com/v2/${key}`,
    [polygon.id]: `https://polygon-mainnet.g.alchemy.com/v2/${key}`,
    [arbitrum.id]: `https://arb-mainnet.g.alchemy.com/v2/${key}`,
    [avalanche.id]: 'https://api.avax.network/ext/bc/C/rpc',
    [hyperEvm.id]: 'https://rpc.hyperliquid.xyz/evm',
  };

  return rpcMap[chainId] || rpcMap[base.id];
}

const appUrl =
  process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || 'http://localhost:3000';

export const config = getDefaultConfig({
  appName: 'Muscadine Curator',
  appDescription: 'Explore Muscadine vaults and track performance',
  appUrl,
  appIcon: `${appUrl}/muscadinelogo.jpg`,
  projectId,
  wallets: [
    {
      groupName: 'Recommended',
      wallets: [
        rabbyWallet,
        metaMaskWallet,
        baseWallet,
        phantomWallet,
        walletConnectWallet,
      ],
    },
  ],
  chains: [...chains],
  ssr: true,
  transports: {
    [base.id]: http(getRpcUrl(base.id)),
    [mainnet.id]: http(getRpcUrl(mainnet.id)),
    [optimism.id]: http(getRpcUrl(optimism.id)),
    [polygon.id]: http(getRpcUrl(polygon.id)),
    [arbitrum.id]: http(getRpcUrl(arbitrum.id)),
    [avalanche.id]: http(getRpcUrl(avalanche.id)),
    [hyperEvm.id]: http(getRpcUrl(hyperEvm.id)),
  },
});
