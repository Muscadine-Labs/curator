import { cookieStorage, createStorage, fallback, http } from 'wagmi';
import { lazyBaseAccount } from '@/lib/wallet/lazy-base-account';
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
  icons: [`${appUrl}/favicon.png`],
};

export const wagmiAdapter = new WagmiAdapter({
  storage: createStorage({
    storage: cookieStorage,
  }),
  ssr: true,
  projectId,
  networks,
  /**
   * Register Base Account here so AppKit does not add its default one, which posts
   * telemetry to as.coinbase.com. Ours turns telemetry off and stays out of the mount-time
   * reconnect until it is used (lazy-base-account.ts), so its SDK does not load on every
   * page. AppKit's Coinbase Wallet SDK connector is off (`enableCoinbase: false` in
   * appkit.ts): it loaded the SDK and sent HEAD requests on every page. The Coinbase
   * Wallet extension still shows through EIP-6963, the app through WalletConnect.
   */
  connectors: [
    lazyBaseAccount({
      appName: metadata.name,
      appLogoUrl: metadata.icons[0],
      preference: { telemetry: false },
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
