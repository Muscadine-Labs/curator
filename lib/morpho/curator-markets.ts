import { gql } from 'graphql-request';
import { morphoGraphQLClient } from '@/lib/morpho/graphql-client';
import { getVaultAddressesForBusinessViews } from '@/lib/config/vaults';
import { isAllocatableMarketCap } from '@/lib/morpho/v2-allocation-targets';
import { isMarketCap } from '@/lib/morpho/cap-utils';
import { mapCap, type GraphCap } from '@/lib/morpho/vault-v2-governance-map';
import { asBlueMarketData } from '@/lib/morpho/blue-market-data';
import {
  computeBlueMarketRiskScores,
  isMarketIdle,
  type MarketRiskScores,
} from '@/lib/morpho/compute-blue-market-risk';
import { getIRMTargetUtilizationWithFallback } from '@/lib/morpho/irm-utils';
import {
  getOracleFeedHintsFromMarket,
  getOracleTimestampData,
  type OracleTimestampData,
} from '@/lib/morpho/oracle-utils';
import { getOraclePriceSnapshot, type OraclePriceSnapshot } from '@/lib/morpho/oracle-price';
import { resolveMarketOracleAddress } from '@/lib/morpho/market-oracle-address';
import { BASE_CHAIN_ID, GRAPHQL_FIRST_LIMIT } from '@/lib/constants';
import type { Address } from 'viem';

export type CuratorMarketListItem = {
  marketId: string;
  chainId: number;
  listed: boolean;
  lltv: string | null;
  loanSymbol: string;
  loanAddress: string | null;
  collateralSymbol: string;
  collateralAddress: string | null;
  /** Morpho `sizeUsd` — total market size (matches Morpho app “Total Market Size”). */
  sizeUsd: number | null;
  supplyAssetsUsd: number | null;
  /** Raw loan supply assets (token units as decimal string). */
  supplyAssets: string | null;
  loanDecimals: number | null;
  /** Morpho `totalLiquidityUsd` — total market liquidity (matches Morpho app column). */
  totalLiquidityUsd: number | null;
  /** Available loan liquidity in the market (`liquidityAssetsUsd`). */
  liquidityAssetsUsd: number | null;
  /** Raw available loan liquidity (token units as decimal string). */
  liquidityAssets: string | null;
  /** Rolling average net supply APY (Morpho `avgNetSupplyApy`, ≈ recent net rate). */
  avgNetSupplyApy: number | null;
  netSupplyApy: number | null;
  utilization: number | null;
  muscadineVaults: MuscadineMarketVaultRef[];
};

export type MuscadineMarketVaultRef = {
  address: string;
  name: string;
  symbol: string;
};

export type MarketBadDebtAmount = {
  usd: number | null;
  /** Loan-token raw units from Morpho GraphQL. */
  underlying: string | null;
};

export type CuratorMarketDetail = CuratorMarketListItem & {
  oracleAddress: string | null;
  irmAddress: string | null;
  loanDecimals: number | null;
  collateralDecimals: number | null;
  supplyApy: number | null;
  borrowApy: number | null;
  borrowAssetsUsd: number | null;
  collateralAssetsUsd: number | null;
  realizedBadDebt: MarketBadDebtAmount | null;
  /** Morpho `badDebt` — open / unrealized bad debt at the market level. */
  unrealizedBadDebt: MarketBadDebtAmount | null;
  scores: MarketRiskScores | null;
  oracleTimestampData: OracleTimestampData | null;
  oraclePrice: OraclePriceSnapshot | null;
  spotCollateralUsd: number | null;
  spotLoanUsd: number | null;
};

const MARKETS_BROWSER_QUERY = gql`
  query CuratorMarketsBrowser($first: Int!, $chainId: Int!) {
    markets(
      first: $first
      orderBy: SizeUsd
      orderDirection: Desc
      where: { chainId_in: [$chainId] }
    ) {
      items {
        marketId
        listed
        lltv
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
        state {
          sizeUsd
          supplyAssets
          supplyAssetsUsd
          totalLiquidityUsd
          liquidityAssets
          liquidityAssetsUsd
          avgNetSupplyApy
          netSupplyApy
          utilization
          supplyApy
          borrowApy
          borrowAssetsUsd
          collateralAssetsUsd
        }
        realizedBadDebt {
          usd
        }
        irmAddress
      }
    }
  }
`;

const MARKET_DETAIL_QUERY = gql`
  query CuratorMarketDetail($marketId: String!, $chainId: Int!) {
    marketById(marketId: $marketId, chainId: $chainId) {
      marketId
      listed
      lltv
      loanAsset {
        address
        symbol
        decimals
        price {
          usd
        }
      }
      collateralAsset {
        address
        symbol
        decimals
        price {
          usd
        }
      }
      irmAddress
      oracle {
        address
        type
        data {
          ... on MorphoChainlinkOracleV2Data {
            scaleFactor
            baseFeedOne {
              address
            }
            baseFeedTwo {
              address
            }
            quoteFeedOne {
              address
            }
            quoteFeedTwo {
              address
            }
          }
          ... on MorphoChainlinkOracleData {
            scaleFactor
            baseFeedOne {
              address
            }
            baseFeedTwo {
              address
            }
            quoteFeedOne {
              address
            }
            quoteFeedTwo {
              address
            }
          }
        }
      }
      state {
        sizeUsd
        supplyAssets
        supplyAssetsUsd
        totalLiquidityUsd
        liquidityAssets
        liquidityAssetsUsd
        avgNetSupplyApy
        netSupplyApy
        utilization
        supplyApy
        borrowApy
        borrowAssetsUsd
        collateralAssetsUsd
      }
      realizedBadDebt {
        usd
        underlying
      }
      badDebt {
        usd
        underlying
      }
    }
  }
`;

const VAULT_MARKET_CAPS_QUERY = gql`
  query VaultMarketCaps($address: String!, $chainId: Int!) {
    vault: vaultV2ByAddress(address: $address, chainId: $chainId) {
      name
      symbol
      caps(first: 200) {
        items {
          type
          absoluteCap
          relativeCap
          data {
            __typename
            ... on MarketV1CapData {
              market {
                marketId
              }
            }
          }
        }
      }
    }
  }
`;

type GraphOracleData = {
  baseFeedOne?: { address?: string | null } | null;
  baseFeedTwo?: { address?: string | null } | null;
  quoteFeedOne?: { address?: string | null } | null;
  quoteFeedTwo?: { address?: string | null } | null;
} | null;

type GraphMarketItem = {
  marketId?: string | null;
  listed?: boolean | null;
  lltv?: string | number | null;
  loanAsset?: {
    address?: string | null;
    symbol?: string | null;
    decimals?: number | null;
    price?: { usd?: number | null } | null;
  } | null;
  collateralAsset?: {
    address?: string | null;
    symbol?: string | null;
    decimals?: number | null;
    price?: { usd?: number | null } | null;
  } | null;
  oracle?: {
    address?: string | null;
    data?: GraphOracleData;
  } | null;
  irmAddress?: string | null;
  state?: {
    sizeUsd?: number | null;
    supplyAssets?: string | number | null;
    supplyAssetsUsd?: number | null;
    totalLiquidityUsd?: number | null;
    liquidityAssets?: string | number | null;
    liquidityAssetsUsd?: number | null;
    avgNetSupplyApy?: number | null;
    netSupplyApy?: number | null;
    utilization?: number | null;
    supplyApy?: number | null;
    borrowApy?: number | null;
    borrowAssetsUsd?: number | null;
    collateralAssetsUsd?: number | null;
  } | null;
  realizedBadDebt?: { usd?: number | null; underlying?: string | number | null } | null;
  badDebt?: { usd?: number | null; underlying?: string | number | null } | null;
};

type MuscadineIndex = Map<string, MuscadineMarketVaultRef[]>;

let muscadineIndexCache: { chainId: number; fetchedAt: number; index: MuscadineIndex } | null =
  null;

const MUSCADINE_INDEX_TTL_MS = 30_000;

async function fetchMuscadineMarketIndex(chainId: number): Promise<MuscadineIndex> {
  const now = Date.now();
  if (
    muscadineIndexCache &&
    muscadineIndexCache.chainId === chainId &&
    now - muscadineIndexCache.fetchedAt < MUSCADINE_INDEX_TTL_MS
  ) {
    return muscadineIndexCache.index;
  }

  const vaults = getVaultAddressesForBusinessViews().filter((v) => v.chainId === chainId);
  const index: MuscadineIndex = new Map();

  await Promise.all(
    vaults.map(async (vault) => {
      try {
        const data = await morphoGraphQLClient.request<{
          vault?: {
            name?: string | null;
            symbol?: string | null;
            caps?: { items?: Array<GraphCap | null> | null } | null;
          } | null;
        }>(VAULT_MARKET_CAPS_QUERY, { address: vault.address, chainId });

        const caps = data.vault?.caps?.items?.map(mapCap).filter(Boolean) ?? [];
        const name = data.vault?.name ?? 'Muscadine Vault';
        const symbol = data.vault?.symbol ?? 'VAULT';

        for (const cap of caps) {
          if (!cap || !isMarketCap(cap) || !isAllocatableMarketCap(cap) || !cap.marketKey) continue;
          const key = cap.marketKey.toLowerCase();
          const ref: MuscadineMarketVaultRef = {
            address: vault.address,
            name,
            symbol,
          };
          const existing = index.get(key) ?? [];
          if (!existing.some((v) => v.address.toLowerCase() === vault.address.toLowerCase())) {
            existing.push(ref);
            index.set(key, existing);
          }
        }
      } catch {
        /* skip vault on GraphQL failure */
      }
    })
  );

  muscadineIndexCache = { chainId, fetchedAt: now, index };
  return index;
}

function parseBadDebtAmount(
  value: { usd?: number | null; underlying?: string | number | null } | null | undefined
): MarketBadDebtAmount | null {
  if (!value) return null;
  return {
    usd: value.usd ?? null,
    underlying:
      value.underlying != null && value.underlying !== ''
        ? String(value.underlying)
        : null,
  };
}

function graphMarketToListItem(
  item: GraphMarketItem,
  chainId: number,
  muscadineIndex: MuscadineIndex
): CuratorMarketListItem | null {
  const marketId = item.marketId;
  if (!marketId) return null;

  const loanSymbol = item.loanAsset?.symbol ?? 'Unknown';
  const collateralSymbol = item.collateralAsset?.symbol ?? 'Unknown';

  return {
    marketId,
    chainId,
    listed: Boolean(item.listed),
    lltv: item.lltv != null ? String(item.lltv) : null,
    loanSymbol,
    loanAddress: item.loanAsset?.address ?? null,
    collateralSymbol,
    collateralAddress: item.collateralAsset?.address ?? null,
    sizeUsd: item.state?.sizeUsd ?? null,
    supplyAssetsUsd: item.state?.supplyAssetsUsd ?? null,
    supplyAssets:
      item.state?.supplyAssets != null && item.state.supplyAssets !== ''
        ? String(item.state.supplyAssets)
        : null,
    loanDecimals: item.loanAsset?.decimals ?? null,
    totalLiquidityUsd: item.state?.totalLiquidityUsd ?? null,
    liquidityAssetsUsd: item.state?.liquidityAssetsUsd ?? null,
    liquidityAssets:
      item.state?.liquidityAssets != null && item.state.liquidityAssets !== ''
        ? String(item.state.liquidityAssets)
        : null,
    avgNetSupplyApy: item.state?.avgNetSupplyApy ?? null,
    netSupplyApy: item.state?.netSupplyApy ?? null,
    utilization: item.state?.utilization ?? null,
    muscadineVaults: muscadineIndex.get(marketId.toLowerCase()) ?? [],
  };
}

export async function fetchCuratorMarkets(chainId: number): Promise<CuratorMarketListItem[]> {
  const [data, muscadineIndex] = await Promise.all([
    morphoGraphQLClient.request<{ markets?: { items?: Array<GraphMarketItem | null> | null } | null }>(
      MARKETS_BROWSER_QUERY,
      { first: GRAPHQL_FIRST_LIMIT, chainId }
    ),
    fetchMuscadineMarketIndex(chainId),
  ]);

  const items = data.markets?.items?.filter((m): m is GraphMarketItem => m != null) ?? [];
  return items
    .map((item) => graphMarketToListItem(item, chainId, muscadineIndex))
    .filter((m): m is CuratorMarketListItem => m != null);
}

export async function fetchCuratorMarketDetail(
  marketId: string,
  chainId: number
): Promise<CuratorMarketDetail | null> {
  const [data, muscadineIndex] = await Promise.all([
    morphoGraphQLClient.request<{ marketById?: GraphMarketItem | null }>(MARKET_DETAIL_QUERY, {
      marketId,
      chainId,
    }),
    fetchMuscadineMarketIndex(chainId),
  ]);

  const item = data.marketById;
  if (!item?.marketId) return null;

  const listItem = graphMarketToListItem(item, chainId, muscadineIndex);
  if (!listItem) return null;

  const market = asBlueMarketData({
    id: item.marketId,
    marketId: item.marketId,
    loanAsset: {
      address: item.loanAsset?.address ?? '',
      symbol: item.loanAsset?.symbol ?? 'Unknown',
      decimals: item.loanAsset?.decimals ?? 18,
    },
    collateralAsset: {
      address: item.collateralAsset?.address ?? '',
      symbol: item.collateralAsset?.symbol ?? 'Unknown',
      decimals: item.collateralAsset?.decimals ?? 18,
    },
    oracleAddress: resolveMarketOracleAddress(item),
    oracle: null,
    irmAddress: item.irmAddress ?? null,
    lltv: item.lltv != null ? String(item.lltv) : null,
    realizedBadDebt:
      item.realizedBadDebt != null
        ? { usd: item.realizedBadDebt.usd ?? null }
        : null,
    state: item.state
      ? {
          supplyAssetsUsd: item.state.supplyAssetsUsd ?? null,
          borrowAssetsUsd: item.state.borrowAssetsUsd ?? null,
          collateralAssetsUsd: item.state.collateralAssetsUsd ?? null,
          liquidityAssets: null,
          liquidityAssetsUsd: item.state.liquidityAssetsUsd ?? null,
          utilization: item.state.utilization ?? null,
          supplyApy: item.state.supplyApy ?? null,
          borrowApy: item.state.borrowApy ?? null,
        }
      : null,
    vaultSupplyAssets: null,
    vaultSupplyAssetsUsd: null,
    vaultTotalAssetsUsd: null,
    marketTotalSupplyUsd: item.state?.supplyAssetsUsd ?? null,
  });

  let scores: MarketRiskScores | null = null;
  let oracleTimestampData: OracleTimestampData | null = null;
  let oraclePrice: OraclePriceSnapshot | null = null;

  const spotCollateralUsd = item.collateralAsset?.price?.usd ?? null;
  const spotLoanUsd = item.loanAsset?.price?.usd ?? null;
  const loanDecimals = item.loanAsset?.decimals ?? 18;
  const collateralDecimals = item.collateralAsset?.decimals ?? 18;

  // Oracle freshness, price bounds, and IRM kink reads use the Base RPC client today.
  // Non-Base market detail UI tells curators to add that chain's RPC to enable scoring.
  if (chainId === BASE_CHAIN_ID && !isMarketIdle(market)) {
    const baseFeedHints = getOracleFeedHintsFromMarket(item);
    const oracleAddr = market.oracleAddress ? (market.oracleAddress as Address) : null;
    const [oracleData, targetUtil, priceSnapshot] = await Promise.all([
      getOracleTimestampData(oracleAddr, baseFeedHints),
      getIRMTargetUtilizationWithFallback(
        market.irmAddress ? (market.irmAddress as Address) : null
      ),
      getOraclePriceSnapshot({
        oracleAddress: market.oracleAddress,
        feedHints: baseFeedHints,
        loanDecimals,
        collateralDecimals,
        spotCollateralUsd,
        spotLoanUsd,
      }),
    ]);
    oracleTimestampData = oracleData;
    oraclePrice = priceSnapshot;
    scores = await computeBlueMarketRiskScores(market, oracleData, targetUtil);
  }

  return {
    ...listItem,
    oracleAddress: resolveMarketOracleAddress(item),
    irmAddress: item.irmAddress ?? null,
    loanDecimals,
    collateralDecimals,
    supplyApy: item.state?.supplyApy ?? null,
    borrowApy: item.state?.borrowApy ?? null,
    borrowAssetsUsd: item.state?.borrowAssetsUsd ?? null,
    collateralAssetsUsd: item.state?.collateralAssetsUsd ?? null,
    realizedBadDebt: parseBadDebtAmount(item.realizedBadDebt),
    unrealizedBadDebt: parseBadDebtAmount(item.badDebt),
    scores,
    oracleTimestampData,
    oraclePrice,
    spotCollateralUsd,
    spotLoanUsd,
  };
}

export function defaultCuratorMarketChainId(): number {
  return BASE_CHAIN_ID;
}
