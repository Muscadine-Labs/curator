import { http } from 'wagmi';
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi';
import type { AppKitNetwork } from '@reown/appkit/networks';
import {
  arbitrum,
  avalanche,
  base,
  hyperEvm,
  mainnet,
  optimism,
  polygon,
} from '@reown/appkit/networks';

export const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'demo';

export const networks = [
  base,
  mainnet,
  optimism,
  polygon,
  arbitrum,
  avalanche,
  hyperEvm,
] as [AppKitNetwork, ...AppKitNetwork[]];

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

// Match Reown's next-wagmi-app-router example: ssr only, no cookieStorage override.
export const wagmiAdapter = new WagmiAdapter({
  projectId,
  networks,
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

export const config = wagmiAdapter.wagmiConfig;

const appUrl =
  process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || 'http://localhost:3000';

export const appKitMetadata = {
  name: 'Muscadine Curator',
  description: 'Explore Muscadine vaults and track performance',
  url: appUrl,
  icons: [`${appUrl}/muscadinelogo.jpg`],
};
