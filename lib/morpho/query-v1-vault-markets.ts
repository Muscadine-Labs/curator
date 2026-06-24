import { gql } from 'graphql-request';
import { morphoGraphQLClient } from './graphql-client';
import { BASE_CHAIN_ID } from '@/lib/constants';

/**
 * GraphQL query for markets behind a MetaMorpho (wrapped) vault — used for
 * underlying Blue market risk scoring on V2 adapter rows.
 */
const VAULT_V1_MARKETS_QUERY = gql`
  query VaultV1Markets($address: String!, $chainId: Int!) {
    vault: vaultByAddress(address: $address, chainId: $chainId) {
      address
      liquidity {
        underlying
        usd
      }
      state {
        totalAssets
        totalAssetsUsd
        netApy
        allocation {
          supplyAssets
          supplyAssetsUsd
          market {
            marketId
            loanAsset {
              symbol
              decimals
              address
            }
            collateralAsset {
              symbol
              decimals
              address
            }
            oracleAddress
            oracle {
              id
              address
              type
              data {
                ... on MorphoChainlinkOracleV2Data {
                  baseFeedOne {
                    address
                  }
                }
                ... on MorphoChainlinkOracleData {
                  baseFeedOne {
                    address
                  }
                }
              }
            }
            irmAddress
            lltv
            realizedBadDebt {
              usd
            }
            state {
              supplyAssetsUsd
              borrowAssetsUsd
              collateralAssetsUsd
              liquidityAssets
              liquidityAssetsUsd
              utilization
              supplyApy
              borrowApy
            }
          }
        }
      }
    }
  }
`;

/**
 * Type definitions for V1 vault markets query response
 */
/** Normalize Morpho API `marketId` (formerly `uniqueKey`) for app consumers. */
export function asV1VaultMarketData(
  market: Omit<V1VaultMarketData, 'uniqueKey'> & { uniqueKey?: string; marketId?: string }
): V1VaultMarketData {
  return {
    ...(market as V1VaultMarketData),
    uniqueKey: market.marketId ?? market.uniqueKey ?? market.id,
  };
}

export type V1VaultMarketData = {
  id: string;
  uniqueKey: string;
  loanAsset: {
    symbol: string;
    decimals: number;
    address: string;
  };
  collateralAsset: {
    symbol: string;
    decimals: number;
    address: string;
  };
  oracleAddress: string | null;
  oracle: {
    id: string;
    address: string;
    type: string; // e.g., "ChainlinkOracleV2"
    data?: {
      baseFeedOne?: {
        address: string;
      } | null;
    } | null;
  } | null;
  irmAddress: string | null;
  lltv: string | null; // BigInt as string
  realizedBadDebt: {
    usd: number | null;
  } | null;
  state: {
    supplyAssetsUsd: number | null;
    borrowAssetsUsd: number | null;
    collateralAssetsUsd: number | null;
    liquidityAssets: string | null;
    liquidityAssetsUsd: number | null;
    utilization: number | null;
    supplyApy: number | null;
    borrowApy: number | null;
  } | null;
  // Vault allocation data for this market
  vaultSupplyAssets: string | null; // Raw amount supplied by vault
  vaultSupplyAssetsUsd: number | null; // USD value of vault supply
  vaultTotalAssetsUsd: number | null; // Total vault assets for percentage calculation
  marketTotalSupplyUsd: number | null; // Total market supply for market share calculation
};

export type V1VaultMarketsQueryResponse = {
  vault: {
    address: string;
    liquidity: {
      underlying: string | null;
      usd: number | null;
    } | null;
    state: {
      totalAssets: string | number | null;
      totalAssetsUsd: number | null;
      netApy: number | null;
      allocation: Array<{
        supplyAssets: string | null;
        supplyAssetsUsd: number | null;
        market: {
          id: string;
          marketId: string;
          loanAsset: {
            symbol: string;
            decimals: number;
            address: string;
          } | null;
          collateralAsset: {
            symbol: string;
            decimals: number;
            address: string;
          } | null;
          oracleAddress: string | null;
          oracle: {
            id: string;
            address: string;
            type: string;
            data?: {
              baseFeedOne?: {
                address: string;
              } | null;
            } | null;
          } | null;
          irmAddress: string | null;
          lltv: string | null;
          realizedBadDebt: {
            usd: number | null;
          } | null;
          state: {
            supplyAssetsUsd: number | null;
            borrowAssetsUsd: number | null;
            collateralAssetsUsd: number | null;
            liquidityAssets: string | null;
            liquidityAssetsUsd: number | null;
            utilization: number | null;
            supplyApy: number | null;
            borrowApy: number | null;
          } | null;
        } | null;
      }> | null;
    } | null;
  } | null;
};

/**
 * Fetch markets for a V1 vault
 */
export type V1VaultSummaryStats = {
  totalAssetsUsd: number | null;
  totalAssets: string | null;
  netApy: number | null;
  liquidityUsd: number | null;
  liquidityUnderlying: string | null;
};

export async function fetchV1VaultMarkets(
  vaultAddress: string,
  chainId: number = BASE_CHAIN_ID
): Promise<{
  markets: V1VaultMarketData[];
  vaultLiquidity: number | null;
  vaultStats: V1VaultSummaryStats;
}> {
  const data = await morphoGraphQLClient.request<V1VaultMarketsQueryResponse>(
    VAULT_V1_MARKETS_QUERY,
    { address: vaultAddress, chainId }
  );

  const vaultTotalAssetsUsd = data.vault?.state?.totalAssetsUsd ?? 0;
  const vaultLiquidity = data.vault?.liquidity?.usd ?? null;
  const vaultStats: V1VaultSummaryStats = {
    totalAssetsUsd: data.vault?.state?.totalAssetsUsd ?? null,
    totalAssets:
      data.vault?.state?.totalAssets != null ? String(data.vault.state.totalAssets) : null,
    netApy: data.vault?.state?.netApy ?? null,
    liquidityUsd: data.vault?.liquidity?.usd ?? null,
    liquidityUnderlying:
      data.vault?.liquidity?.underlying != null ? String(data.vault.liquidity.underlying) : null,
  };

  if (!data.vault?.state?.allocation) {
    return {
      markets: [],
      vaultLiquidity,
      vaultStats,
    };
  }

  const markets = data.vault.state.allocation
    .map((alloc) => {
      if (!alloc.market) return null;

      const market: V1VaultMarketData = {
        id: alloc.market.id,
        uniqueKey: alloc.market.marketId,
        loanAsset: alloc.market.loanAsset || { symbol: 'Unknown', decimals: 18, address: '' },
        collateralAsset: alloc.market.collateralAsset || { symbol: 'Unknown', decimals: 18, address: '' },
        oracleAddress: alloc.market.oracleAddress,
        oracle: alloc.market.oracle
          ? {
              id: alloc.market.oracle.id,
              address: alloc.market.oracle.address,
              type: alloc.market.oracle.type,
              data: alloc.market.oracle.data || null,
            }
          : null,
        irmAddress: alloc.market.irmAddress,
        lltv: alloc.market.lltv,
        realizedBadDebt: alloc.market.realizedBadDebt,
        state: alloc.market.state,
        vaultSupplyAssets: alloc.supplyAssets,
        vaultSupplyAssetsUsd: alloc.supplyAssetsUsd ?? null,
        vaultTotalAssetsUsd,
        marketTotalSupplyUsd: alloc.market.state?.supplyAssetsUsd ?? null,
      };

      return market;
    })
    .filter((market): market is V1VaultMarketData => market !== null);

  return {
    markets,
    vaultLiquidity,
    vaultStats,
  };
}
