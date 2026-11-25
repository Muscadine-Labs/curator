import {
  BASE_CBBTC_ADDRESS,
  BASE_CHAIN_ID,
  BASE_USDC_ADDRESS,
  BASE_WETH_ADDRESS,
} from '@/lib/constants';
import { MorphoRestError } from '@/lib/morpho/rest-client';
import { getRestToken, getRestTokenPriceUsd } from '@/lib/morpho/rest-data';
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
/** Token metadata never changes, but the server lives long: keep the newest entries only. */
const GQL_CACHE_MAX_ENTRIES = 5_000;

function rememberTokenMeta(key: string, meta: KnownTokenMeta): void {
  gqlCache.delete(key);
  gqlCache.set(key, meta);
  while (gqlCache.size > GQL_CACHE_MAX_ENTRIES) {
    const oldest = gqlCache.keys().next().value;
    if (oldest === undefined) break;
    gqlCache.delete(oldest);
  }
}
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

/** Morpho REST said it does not index this token (404); skip it until expiry. */
const morphoMetaMiss = new Map<string, number>();

/** Parallel REST reads per prefetch (REST has no batch token route; one call per token). */
const PREFETCH_CONCURRENCY = 8;

/**
 * Warm metadata (and, with `prices`, USD spot) for many tokens before resolving a list,
 * filling the same caches `resolveTokenMeta` / `fetchAssetUsdPrice` read. Morpho REST has
 * one route per token, so this runs them 8 at a time; failures fall back per token later.
 */
export async function prefetchAssets(
  addresses: readonly string[],
  chainId: number = BASE_CHAIN_ID,
  options: { prices?: boolean } = {}
): Promise<void> {
  const now = Date.now();
  const wanted = [...new Set(addresses.map((a) => a.toLowerCase()))].filter((address) => {
    const key = `${chainId}:${address}`;
    const needsMeta =
      !knownTokenMeta(address) &&
      !gqlCache.has(key) &&
      !((fallbackCache.get(key)?.expiresAt ?? 0) > now) &&
      !((morphoMetaMiss.get(key) ?? 0) > now);
    const needsPrice = options.prices === true && !((priceCache.get(key)?.expiresAt ?? 0) > now);
    return needsMeta || needsPrice;
  });
  let next = 0;
  const worker = async () => {
    while (next < wanted.length) {
      const address = wanted[next++]!;
      await Promise.all([
        resolveTokenMeta(address, chainId).catch(() => null),
        options.prices ? fetchAssetUsdPrice(address, chainId).catch(() => null) : null,
      ]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PREFETCH_CONCURRENCY, wanted.length) }, worker));
}

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
  // Morpho REST just said it has nothing for this token: go straight to the chain.
  const skipMorpho = (morphoMetaMiss.get(key) ?? 0) > Date.now();

  try {
    if (skipMorpho) throw new Error('not indexed');
    const token = await getRestToken(chainId, address);
    const symbol = token.symbol?.trim();
    if (symbol && token.decimals != null) {
      const meta: KnownTokenMeta = { address, symbol, decimals: token.decimals };
      rememberTokenMeta(key, meta);
      rememberTokenMeta(address.toLowerCase(), meta);
      return meta;
    }
  } catch (error) {
    if (error instanceof MorphoRestError && error.status === 404) {
      morphoMetaMiss.set(key, Date.now() + API_CACHE_MAX_AGE_MS);
    }
    // fall through to the chain
  }

  // Decimals decide every amount on the page: never cache a guess for good.
  const onChain = chainId === BASE_CHAIN_ID ? await readTokenMetaOnChain(address) : null;
  if (onChain) {
    rememberTokenMeta(key, onChain);
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

/** Morpho REST USD spot (`/v0/tokens/{t}/price`) for oracle comparison panels and USD values. */
export async function fetchAssetUsdPrice(
  address: string,
  chainId: number = BASE_CHAIN_ID
): Promise<number | null> {
  const key = `${chainId}:${address.toLowerCase()}`;
  const cachedPrice = priceCache.get(key);
  if (cachedPrice && cachedPrice.expiresAt > Date.now()) return cachedPrice.usd;

  try {
    const value = await getRestTokenPriceUsd(chainId, address);
    priceCache.set(key, { usd: value, expiresAt: Date.now() + API_CACHE_MAX_AGE_MS });
    return value;
  } catch (error) {
    if (error instanceof MorphoRestError && error.status === 404) {
      priceCache.set(key, { usd: null, expiresAt: Date.now() + API_CACHE_MAX_AGE_MS });
      return null;
    }
    return cachedPrice?.usd ?? null;
  }
}
