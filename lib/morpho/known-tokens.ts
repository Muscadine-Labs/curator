import {
  BASE_CBBTC_ADDRESS,
  BASE_CHAIN_ID,
  BASE_USDC_ADDRESS,
  BASE_WETH_ADDRESS,
} from '@/lib/constants';
import { morphoGraphQLClient } from '@/lib/morpho/graphql-client';
import { gql } from 'graphql-request';
import { parseAbi, type Address } from 'viem';
import { publicClient } from '@/lib/onchain/client';
import { API_CACHE_MAX_AGE_MS } from '@/lib/api/response-cache';

export type KnownTokenMeta = {
  address: string;
  symbol: string;
  decimals: number;
};

const KNOWN: Record<string, KnownTokenMeta> = {
  [BASE_USDC_ADDRESS.toLowerCase()]: {
    address: BASE_USDC_ADDRESS,
    symbol: 'USDC',
    decimals: 6,
  },
  [BASE_WETH_ADDRESS.toLowerCase()]: {
    address: BASE_WETH_ADDRESS,
    symbol: 'WETH',
    decimals: 18,
  },
  [BASE_CBBTC_ADDRESS.toLowerCase()]: {
    address: BASE_CBBTC_ADDRESS,
    symbol: 'cbBTC',
    decimals: 8,
  },
};

const gqlCache = new Map<string, KnownTokenMeta>();
/** Unresolved tokens keep a placeholder only for the cache window, then retry. */
const fallbackCache = new Map<string, { meta: KnownTokenMeta; expiresAt: number }>();

const ERC20_META_ABI = parseAbi([
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
]);

/** On-chain ERC-20 metadata (Base RPC) when Morpho does not answer. */
async function readTokenMetaOnChain(address: string): Promise<KnownTokenMeta | null> {
  try {
    const results = await publicClient.multicall({
      allowFailure: true,
      contracts: [
        { address: address as Address, abi: ERC20_META_ABI, functionName: 'decimals' },
        { address: address as Address, abi: ERC20_META_ABI, functionName: 'symbol' },
      ],
    });
    const decimals = results[0].status === 'success' ? Number(results[0].result) : null;
    const symbol = results[1].status === 'success' ? String(results[1].result).trim() : '';
    if (decimals == null || !Number.isFinite(decimals)) return null;
    return { address, symbol: symbol || `${address.slice(0, 6)}…`, decimals };
  } catch {
    return null;
  }
}

const ASSET_META_QUERY = gql`
  query TokenMeta($address: String!, $chainId: Int!) {
    assetByAddress(address: $address, chainId: $chainId) {
      address
      symbol
      decimals
    }
  }
`;

const ASSET_PRICE_QUERY = gql`
  query AssetPrice($address: String!, $chainId: Int!) {
    assetByAddress(address: $address, chainId: $chainId) {
      price {
        usd
      }
    }
  }
`;

function knownTokenMeta(address: string): KnownTokenMeta | null {
  return KNOWN[address.toLowerCase()] ?? gqlCache.get(address.toLowerCase()) ?? null;
}

export async function resolveTokenMeta(
  address: string,
  chainId: number = BASE_CHAIN_ID
): Promise<KnownTokenMeta> {
  const cached = knownTokenMeta(address);
  if (cached) return cached;

  const key = `${chainId}:${address.toLowerCase()}`;
  const hit = gqlCache.get(key);
  if (hit) return hit;
  const held = fallbackCache.get(key);
  if (held && held.expiresAt > Date.now()) return held.meta;

  try {
    const data = await morphoGraphQLClient.request<{
      assetByAddress?: {
        address?: string | null;
        symbol?: string | null;
        decimals?: number | null;
      } | null;
    }>(ASSET_META_QUERY, { address, chainId });
    const symbol = data.assetByAddress?.symbol?.trim();
    const decimals = data.assetByAddress?.decimals;
    if (symbol && decimals != null) {
      const meta: KnownTokenMeta = {
        address,
        symbol,
        decimals,
      };
      gqlCache.set(key, meta);
      gqlCache.set(address.toLowerCase(), meta);
      return meta;
    }
  } catch {
    // fall through to the chain
  }

  // Decimals decide every amount on the page: never cache a guess for good.
  const onChain = chainId === BASE_CHAIN_ID ? await readTokenMetaOnChain(address) : null;
  if (onChain) {
    gqlCache.set(key, onChain);
    return onChain;
  }
  const fallback: KnownTokenMeta = {
    address,
    symbol: `${address.slice(0, 6)}…`,
    decimals: 18,
  };
  fallbackCache.set(key, { meta: fallback, expiresAt: Date.now() + API_CACHE_MAX_AGE_MS });
  return fallback;
}

/** Spot USD, capped at the app-wide 30s TTL; failures are not cached. */
const priceCache = new Map<string, { usd: number | null; expiresAt: number }>();

/** Morpho-indexed USD spot for oracle comparison panels. */
export async function fetchAssetUsdPrice(
  address: string,
  chainId: number = BASE_CHAIN_ID
): Promise<number | null> {
  const key = `${chainId}:${address.toLowerCase()}`;
  const cachedPrice = priceCache.get(key);
  if (cachedPrice && cachedPrice.expiresAt > Date.now()) return cachedPrice.usd;

  try {
    const data = await morphoGraphQLClient.request<{
      assetByAddress?: { price?: { usd?: number | null } | null } | null;
    }>(ASSET_PRICE_QUERY, { address, chainId });
    const usd = data.assetByAddress?.price?.usd;
    const value = usd != null && Number.isFinite(usd) ? usd : null;
    priceCache.set(key, { usd: value, expiresAt: Date.now() + API_CACHE_MAX_AGE_MS });
    return value;
  } catch {
    return cachedPrice?.usd ?? null;
  }
}
