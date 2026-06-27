import { resolveMarketOracleAddress } from '@/lib/morpho/market-oracle-address';

/** Normalize Morpho GraphQL `marketId` into app `marketKey`. */
export function asBlueMarketData(
  market: Omit<BlueMarketData, 'marketKey'> & {
    marketKey?: string;
    marketId?: string;
    oracle?: { address?: string | null } | null;
  }
): BlueMarketData {
  const marketKey = market.marketId ?? market.marketKey ?? market.id;
  return {
    ...(market as BlueMarketData),
    id: market.id ?? marketKey,
    marketKey,
    oracleAddress: resolveMarketOracleAddress(market),
  };
}

/** Shared Morpho Blue market shape for risk scoring and market detail UI. */
export type BlueMarketData = {
  id: string;
  marketKey: string;
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
  vaultSupplyAssets?: string | null;
  vaultSupplyAssetsUsd?: number | null;
  vaultTotalAssetsUsd?: number | null;
  marketTotalSupplyUsd?: number | null;
};
