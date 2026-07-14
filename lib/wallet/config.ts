import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import {
  base as baseWallet,
  metaMaskWallet,
  phantomWallet,
  rabbyWallet,
  walletConnectWallet,
} from '@rainbow-me/rainbowkit/wallets';
import { http } from 'wagmi';
import { base, mainnet, polygon } from 'wagmi/chains';
import { defineChain } from 'viem';
import {
  BASE_CHAIN_ID,
  ETHEREUM_CHAIN_ID,
  HYPEREVM_CHAIN_ID,
  POLYGON_CHAIN_ID,
  ROBINHOOD_CHAIN_ID,
} from '@/lib/constants';

export const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'demo';

export const hyperEvm = defineChain({
  id: HYPEREVM_CHAIN_ID,
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

export const robinhood = defineChain({
  id: ROBINHOOD_CHAIN_ID,
  name: 'Robinhood',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.mainnet.chain.robinhood.com'] },
  },
  blockExplorers: {
    default: {
      name: 'Robinhood Explorer',
      url: 'https://explorer.mainnet.chain.robinhood.com',
    },
  },
});

/** Same five networks as CURATOR_MARKET_NETWORKS (order: Base → Ethereum → HyperEVM → Robinhood → Polygon). */
export const chains = [base, mainnet, hyperEvm, robinhood, polygon] as const;

function getRpcUrl(chainId: number): string {
  const alchemyKey = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY;
  const key = alchemyKey || 'demo';

  const rpcMap: Record<number, string> = {
    [BASE_CHAIN_ID]: `https://base-mainnet.g.alchemy.com/v2/${key}`,
    [ETHEREUM_CHAIN_ID]: `https://eth-mainnet.g.alchemy.com/v2/${key}`,
    [HYPEREVM_CHAIN_ID]: 'https://rpc.hyperliquid.xyz/evm',
    [ROBINHOOD_CHAIN_ID]: 'https://rpc.mainnet.chain.robinhood.com',
    [POLYGON_CHAIN_ID]: `https://polygon-mainnet.g.alchemy.com/v2/${key}`,
  };

  return rpcMap[chainId] || rpcMap[BASE_CHAIN_ID];
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
    [base.id]: http(getRpcUrl(BASE_CHAIN_ID)),
    [mainnet.id]: http(getRpcUrl(ETHEREUM_CHAIN_ID)),
    [hyperEvm.id]: http(getRpcUrl(HYPEREVM_CHAIN_ID)),
    [robinhood.id]: http(getRpcUrl(ROBINHOOD_CHAIN_ID)),
    [polygon.id]: http(getRpcUrl(POLYGON_CHAIN_ID)),
  },
});
