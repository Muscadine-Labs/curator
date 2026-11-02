import { cookieStorage, createStorage, fallback, http } from 'wagmi';
import { baseAccount } from 'wagmi/connectors';
import { coinbaseWalletForAppKit } from '@/lib/wallet/coinbase-connector';
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi';
import type { AppKitNetwork } from '@reown/appkit/networks';
import { BASE_CHAIN_ID } from '@/lib/constants';
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

const base = eip155Network(baseChain);

/** Same networks as CURATOR_MARKET_NETWORKS. Base only. */
export const networks: [AppKitNetwork, ...AppKitNetwork[]] = [base];

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
  /**
   * Register Base Account and Coinbase here so AppKit does not add its defaults.
   * Defaults post telemetry to as.coinbase.com, which tracker blockers reject.
   * Coinbase's id is rewritten to `coinbaseWallet` in coinbaseWalletForAppKit.
   */
  connectors: [
    baseAccount({
      appName: metadata.name,
      appLogoUrl: metadata.icons[0],
      preference: { telemetry: false },
    }),
    coinbaseWalletForAppKit({
      appName: metadata.name,
      appLogoUrl: metadata.icons[0],
    }),
  ],
  transports: {
    [BASE_CHAIN_ID]: transportFor(BASE_CHAIN_ID),
  },
});

export const config = wagmiAdapter.wagmiConfig;

declare module 'wagmi' {
  interface Register {
    config: typeof config;
  }
}
