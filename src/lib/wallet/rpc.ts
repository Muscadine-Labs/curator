import {
  BASE_CHAIN_ID,
  ETHEREUM_CHAIN_ID,
  HYPEREVM_CHAIN_ID,
  ROBINHOOD_CHAIN_ID,
} from '@/lib/constants';

export const PUBLIC_RPC: Record<number, string> = {
  [BASE_CHAIN_ID]: 'https://mainnet.base.org',
  [ETHEREUM_CHAIN_ID]: 'https://ethereum.publicnode.com',
  [HYPEREVM_CHAIN_ID]: 'https://rpc.hyperliquid.xyz/evm',
  [ROBINHOOD_CHAIN_ID]: 'https://rpc.mainnet.chain.robinhood.com',
};

const ALCHEMY_HOST: Partial<Record<number, string>> = {
  [BASE_CHAIN_ID]: 'base-mainnet',
  [ETHEREUM_CHAIN_ID]: 'eth-mainnet',
};

function alchemyUrl(host: string): string | null {
  const key = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY?.trim();
  if (!key) return null;
  return `https://${host}.g.alchemy.com/v2/${key}`;
}

export function getWalletRpcUrl(chainId: number): string {
  const host = ALCHEMY_HOST[chainId];
  const alchemy = host ? alchemyUrl(host) : null;
  if (alchemy) return alchemy;
  return PUBLIC_RPC[chainId] || PUBLIC_RPC[BASE_CHAIN_ID];
}

export function alchemyRpcUrl(chainId: number): string | null {
  const host = ALCHEMY_HOST[chainId];
  return host ? alchemyUrl(host) : null;
}
