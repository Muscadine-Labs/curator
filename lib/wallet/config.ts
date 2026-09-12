import { cookieStorage, createStorage, fallback, http } from 'wagmi';
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi';
import type { AppKitNetwork } from '@reown/appkit/networks';
import {
  BASE_CHAIN_ID,
  ETHEREUM_CHAIN_ID,
  HYPEREVM_CHAIN_ID,
  ROBINHOOD_CHAIN_ID,
} from '@/lib/constants';
import { base as baseChain } from '@/lib/onchain/base-chain';
import { getAppUrl } from '@/lib/wallet/app-url';
import { alchemyRpcUrl, PUBLIC_RPC } from '@/lib/wallet/rpc';

export const projectId =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim() || 'demo';

function eip155Network(chain: {
  id: number;
  name: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  rpcUrls: { default: { http: readonly string[] } };
  blockExplorers?: { default: { name: string; url: string; apiUrl?: string } };
  contracts?: { multicall3?: { address: `0x${string}`; blockCreated?: number } };
}): AppKitNetwork {
  return {
    ...chain,
    chainNamespace: 'eip155',
    caipNetworkId: `eip155:${chain.id}`,
  } as AppKitNetwork;
}

const mainnet = eip155Network({
  id: ETHEREUM_CHAIN_ID,
  name: 'Ethereum',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [PUBLIC_RPC[ETHEREUM_CHAIN_ID]] } },
  blockExplorers: { default: { name: 'Etherscan', url: 'https://etherscan.io' } },
  contracts: {
    multicall3: {
      address: '0xca11bde05977b3631167028862be2a173976ca11',
      blockCreated: 14353601,
    },
  },
});

const hyperEvm = eip155Network({
  id: HYPEREVM_CHAIN_ID,
  name: 'HyperEVM',
  nativeCurrency: { name: 'HYPE', symbol: 'HYPE', decimals: 18 },
  rpcUrls: { default: { http: [PUBLIC_RPC[HYPEREVM_CHAIN_ID]] } },
  blockExplorers: { default: { name: 'HyperEVMScan', url: 'https://hyperevmscan.io' } },
  contracts: {
    multicall3: {
      address: '0xcA11bde05977b3631167028862bE2a173976CA11',
      blockCreated: 13051,
    },
  },
});

const robinhood = eip155Network({
  id: ROBINHOOD_CHAIN_ID,
  name: 'Robinhood',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [PUBLIC_RPC[ROBINHOOD_CHAIN_ID]] } },
  blockExplorers: {
    default: {
      name: 'Robinhood Explorer',
      url: 'https://explorer.mainnet.chain.robinhood.com',
    },
  },
});

const base = eip155Network(baseChain);

/** Same networks as CURATOR_MARKET_NETWORKS (order: Base → Ethereum → HyperEVM → Robinhood). */
export const networks: [AppKitNetwork, ...AppKitNetwork[]] = [
  base,
  mainnet,
  hyperEvm,
  robinhood,
];

/** viem/wagmi chain list used by `useVaultWrite` to switch before signing. */
export const chains = networks;

function transportFor(chainId: number) {
  const publicUrl = PUBLIC_RPC[chainId] || PUBLIC_RPC[BASE_CHAIN_ID];
  const alchemy = alchemyRpcUrl(chainId);
  if (alchemy) return fallback([http(alchemy), http(publicUrl)]);
  return http(publicUrl);
}

const appUrl = getAppUrl();

export const metadata = {
  name: 'Muscadine Curator',
  description: 'Explore Muscadine vaults and track performance',
  url: appUrl,
  icons: [`${appUrl}/muscadinelogo.jpg`],
};

export const wagmiAdapter = new WagmiAdapter({
  storage: createStorage({
    storage: cookieStorage,
  }),
  ssr: true,
  projectId,
  networks,
  transports: {
    [BASE_CHAIN_ID]: transportFor(BASE_CHAIN_ID),
    [ETHEREUM_CHAIN_ID]: transportFor(ETHEREUM_CHAIN_ID),
    [HYPEREVM_CHAIN_ID]: transportFor(HYPEREVM_CHAIN_ID),
    [ROBINHOOD_CHAIN_ID]: transportFor(ROBINHOOD_CHAIN_ID),
  },
});

export const config = wagmiAdapter.wagmiConfig;

declare module 'wagmi' {
  interface Register {
    config: typeof config;
  }
}
