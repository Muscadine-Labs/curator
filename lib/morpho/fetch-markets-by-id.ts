import { API_CACHE_MAX_AGE_MS } from '@/lib/api/response-cache';
import { gql } from 'graphql-request';
import type { CapInfo } from '@/app/api/vaults/v2/[id]/governance/route';
import { BASE_CHAIN_ID, GRAPHQL_FIRST_LIMIT } from '@/lib/constants';
import { isCollateralCap, isMarketCap } from '@/lib/morpho/cap-utils';
import { morphoGraphQLClient } from '@/lib/morpho/graphql-client';
import { resolveMarketOracleAddress } from '@/lib/morpho/market-oracle-address';

const MARKETS_FOR_CAPS_QUERY = gql`
  query MarketsForCapLookup($first: Int!, $chainId: Int!) {
    markets(first: $first, where: { chainId_in: [$chainId] }) {
      items {
        marketId
        loanAsset {
          address
          symbol
          decimals
        }
        collateralAsset {
          address
          symbol
          decimals
        }
        irmAddress
        lltv
        oracle {
          address
        }
        state {
          supplyApy
          borrowApy
          utilization
          liquidityAssets
          liquidityAssetsUsd
        }
      }
    }
  }
`;

export type MarketStateSnapshot = {
  supplyApy?: number | null;
  borrowApy?: number | null;
  utilization?: number | null;
  liquidityAssets?: string | number | null;
  liquidityAssetsUsd?: number | null;
};

type GraphMarketItem = {
  marketId?: string | null;
  loanAsset?: { address?: string | null; symbol?: string | null; decimals?: number | null } | null;
  collateralAsset?: { address?: string | null; symbol?: string | null; decimals?: number | null } | null;
  irmAddress?: string | null;
  lltv?: string | number | null;
  oracle?: { address?: string | null } | null;
  state?: MarketStateSnapshot | null;
};

export type MarketLookupEntry = {
  params: NonNullable<CapInfo['marketParams']>;
  state: MarketStateSnapshot | null;
};

export type MarketParamsLookup = Map<string, NonNullable<CapInfo['marketParams']>>;
export type MarketLookup = Map<string, MarketLookupEntry>;

const CACHE_TTL_MS = API_CACHE_MAX_AGE_MS;
let cachedLookup: { chainId: number; fetchedAt: number; map: MarketLookup } | null = null;

function keysForMarket(item: GraphMarketItem): string[] {
  return [item.marketId]
    .filter((k): k is string => Boolean(k))
    .map((k) => k.toLowerCase());
}

function graphMarketToEntry(item: GraphMarketItem): MarketLookupEntry | null {
  if (!item.loanAsset?.address || !item.collateralAsset?.address) return null;
  return {
    params: {
      loanAsset: {
        address: item.loanAsset.address,
        symbol: item.loanAsset.symbol ?? null,
        decimals: item.loanAsset.decimals ?? null,
      },
      collateralAsset: {
        address: item.collateralAsset.address,
        symbol: item.collateralAsset.symbol ?? null,
        decimals: item.collateralAsset.decimals ?? null,
      },
      oracleAddress: resolveMarketOracleAddress(item),
      irmAddress: item.irmAddress ?? null,
      lltv: item.lltv != null ? String(item.lltv) : null,
      state: item.state ?? null,
    },
    state: item.state ?? null,
  };
}

export async function fetchMarketLookup(chainId: number = BASE_CHAIN_ID): Promise<MarketLookup> {
  const now = Date.now();
  if (
    cachedLookup &&
    cachedLookup.chainId === chainId &&
    now - cachedLookup.fetchedAt < CACHE_TTL_MS
  ) {
    return cachedLookup.map;
  }

  const data = await morphoGraphQLClient.request<{
    markets?: { items?: Array<GraphMarketItem | null> | null } | null;
  }>(MARKETS_FOR_CAPS_QUERY, { first: GRAPHQL_FIRST_LIMIT, chainId });

  const map: MarketLookup = new Map();
  for (const item of data.markets?.items ?? []) {
    if (!item) continue;
    const entry = graphMarketToEntry(item);
    if (!entry) continue;
    for (const key of keysForMarket(item)) {
      map.set(key, entry);
    }
  }

  cachedLookup = { chainId, fetchedAt: now, map };
  return map;
}

export async function fetchMarketParamsLookup(
  chainId: number = BASE_CHAIN_ID
): Promise<MarketParamsLookup> {
  const lookup = await fetchMarketLookup(chainId);
  const map: MarketParamsLookup = new Map();
  for (const [key, entry] of lookup) {
    map.set(key, entry.params);
  }
  return map;
}

function hasCompleteMarketParams(params: CapInfo['marketParams']): boolean {
  return Boolean(
    params?.loanAsset?.address &&
      params?.collateralAsset?.address &&
      params?.oracleAddress &&
      params?.irmAddress &&
      params?.lltv
  );
}

/** Fill marketParams (and spot state) on market caps from Morpho Blue market index. */
export async function enrichMarketCapParams(
  caps: CapInfo[],
  chainId: number
): Promise<CapInfo[]> {
  const needsLookup = caps.some(
    (cap) => isMarketCap(cap) && Boolean(cap.marketKey)
  );
  if (!needsLookup) return caps;

  const lookup = await fetchMarketLookup(chainId);
  return caps.map((cap) => {
    if (!isMarketCap(cap) || !cap.marketKey) return cap;
    const found = lookup.get(cap.marketKey.toLowerCase());
    if (!found) return cap;

    const existing = cap.marketParams;
    const params = hasCompleteMarketParams(existing)
      ? {
          ...existing!,
          loanAsset: {
            address: existing!.loanAsset!.address,
            symbol: existing!.loanAsset?.symbol ?? found.params.loanAsset?.symbol ?? null,
            decimals: existing!.loanAsset?.decimals ?? found.params.loanAsset?.decimals ?? null,
          },
          collateralAsset: {
            address: existing!.collateralAsset!.address,
            symbol: existing!.collateralAsset?.symbol ?? found.params.collateralAsset?.symbol ?? null,
            decimals:
              existing!.collateralAsset?.decimals ?? found.params.collateralAsset?.decimals ?? null,
          },
          state: existing?.state ?? found.state ?? found.params.state ?? null,
        }
      : { ...found.params, state: found.state ?? found.params.state ?? null };

    return { ...cap, marketParams: params };
  });
}

async function fetchTokenSymbolLookup(chainId: number): Promise<Map<string, string>> {
  const paramsLookup = await fetchMarketParamsLookup(chainId);
  const symbols = new Map<string, string>();
  for (const params of paramsLookup.values()) {
    const loan = params.loanAsset;
    const col = params.collateralAsset;
    if (loan?.address && loan.symbol) {
      symbols.set(loan.address.toLowerCase(), loan.symbol);
    }
    if (col?.address && col.symbol) {
      symbols.set(col.address.toLowerCase(), col.symbol);
    }
  }
  return symbols;
}

const ASSET_SYMBOLS_QUERY = gql`
  query AssetSymbols($chainId: Int!, $addresses: [String!]!) {
    assets(where: { chainId_in: [$chainId], address_in: $addresses }) {
      items {
        address
        symbol
      }
    }
  }
`;

async function fetchAssetSymbols(
  addresses: string[],
  chainId: number
): Promise<Map<string, string>> {
  if (addresses.length === 0) return new Map();

  const data = await morphoGraphQLClient.request<{
    assets?: { items?: Array<{ address?: string | null; symbol?: string | null } | null> | null } | null;
  }>(ASSET_SYMBOLS_QUERY, { chainId, addresses });

  const symbols = new Map<string, string>();
  for (const item of data.assets?.items ?? []) {
    if (item?.address && item.symbol) {
      symbols.set(item.address.toLowerCase(), item.symbol);
    }
  }
  return symbols;
}

/** Resolve collateral cap labels from Morpho Blue market token index. */
export async function enrichCollateralCapSymbols(
  caps: CapInfo[],
  chainId: number
): Promise<CapInfo[]> {
  const needsEnrichment = caps.some(
    (cap) => isCollateralCap(cap) && cap.collateralAddress && !cap.collateralSymbol
  );
  if (!needsEnrichment) return caps;

  const lookup = await fetchTokenSymbolLookup(chainId);
  let enriched = caps.map((cap) => {
    if (!isCollateralCap(cap) || !cap.collateralAddress || cap.collateralSymbol) return cap;
    const symbol = lookup.get(cap.collateralAddress.toLowerCase());
    return symbol ? { ...cap, collateralSymbol: symbol } : cap;
  });

  const missingAddresses = [
    ...new Set(
      enriched
        .filter(
          (cap) =>
            isCollateralCap(cap) && cap.collateralAddress && !cap.collateralSymbol
        )
        .map((cap) => cap.collateralAddress as string)
    ),
  ];
  if (missingAddresses.length === 0) return enriched;

  const assetSymbols = await fetchAssetSymbols(missingAddresses, chainId);
  enriched = enriched.map((cap) => {
    if (!isCollateralCap(cap) || !cap.collateralAddress || cap.collateralSymbol) return cap;
    const symbol = assetSymbols.get(cap.collateralAddress.toLowerCase());
    return symbol ? { ...cap, collateralSymbol: symbol } : cap;
  });

  return enriched;
}
