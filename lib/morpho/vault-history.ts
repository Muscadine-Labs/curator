import { gql } from 'graphql-request';

export type MorphoTimeseriesPoint = { x?: number | null; y?: number | null };

export type VaultHistoryChartPoint = {
  date: string;
  value: number;
};

export type VaultHistoryRawPoint = { date: string; value: string };

export type VaultHistorySeries = {
  /** Raw underlying token amount (stringified integer). */
  supplied: VaultHistoryRawPoint[];
  suppliedUsd: VaultHistoryChartPoint[];
  /** Liquidity (USD) = Morpho withdrawable amount. Not indexed historically — spot only. */
  liquidityUsd: VaultHistoryChartPoint[];
  /** Liquidity in raw token units. Not indexed historically — spot only. */
  liquidity: VaultHistoryRawPoint[];
  /** Net / avg net APY as percent (e.g. 4.5 = 4.5%). */
  apy: VaultHistoryChartPoint[];
};

export const VAULT_V1_HISTORY_QUERY = gql`
  query VaultV1History($address: String!, $chainId: Int!, $options: TimeseriesOptions) {
    vault: vaultByAddress(address: $address, chainId: $chainId) {
      asset {
        symbol
        decimals
      }
      historicalState {
        totalAssets(options: $options) {
          x
          y
        }
        totalAssetsUsd(options: $options) {
          x
          y
        }
        netApy(options: $options) {
          x
          y
        }
      }
    }
  }
`;

export const VAULT_V2_HISTORY_QUERY = gql`
  query VaultV2History($address: String!, $chainId: Int!, $options: TimeseriesOptions) {
    vault: vaultV2ByAddress(address: $address, chainId: $chainId) {
      asset {
        symbol
        decimals
      }
      historicalState {
        totalAssets(options: $options) {
          x
          y
        }
        totalAssetsUsd(options: $options) {
          x
          y
        }
        avgNetApy(options: $options) {
          x
          y
        }
      }
    }
  }
`;

function dayKeyFromTimestamp(seconds: number): string {
  const d = new Date(seconds * 1000);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/** Normalize Morpho `{x,y}` points to one value per calendar day (latest sample wins). */
export function mapMorphoTimeseries(
  points: MorphoTimeseriesPoint[] | null | undefined,
  transform: (y: number) => number = (y) => y
): VaultHistoryChartPoint[] {
  if (!points?.length) return [];

  const dayMap = new Map<string, { date: string; value: number; timestamp: number }>();

  for (const point of points) {
    if (point.x == null || point.y == null) continue;
    const date = dayKeyFromTimestamp(point.x);
    const timestamp = point.x * 1000;
    const value = transform(point.y);
    const existing = dayMap.get(date);
    if (!existing || timestamp > existing.timestamp) {
      dayMap.set(date, { date, value, timestamp });
    }
  }

  return Array.from(dayMap.values())
    .map(({ date, value }) => ({ date, value }))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

export function mapMorphoTimeseriesRaw(
  points: MorphoTimeseriesPoint[] | null | undefined
): Array<{ date: string; value: string }> {
  if (!points?.length) return [];

  const dayMap = new Map<string, { date: string; value: string; timestamp: number }>();

  for (const point of points) {
    if (point.x == null || point.y == null) continue;
    const date = dayKeyFromTimestamp(point.x);
    const timestamp = point.x * 1000;
    const value = String(point.y);
    const existing = dayMap.get(date);
    if (!existing || timestamp > existing.timestamp) {
      dayMap.set(date, { date, value, timestamp });
    }
  }

  return Array.from(dayMap.values())
    .map(({ date, value }) => ({ date, value }))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

export function buildV1HistorySeries(historicalState?: {
  totalAssets?: MorphoTimeseriesPoint[] | null;
  totalAssetsUsd?: MorphoTimeseriesPoint[] | null;
  netApy?: MorphoTimeseriesPoint[] | null;
} | null): VaultHistorySeries {
  return {
    supplied: mapMorphoTimeseriesRaw(historicalState?.totalAssets),
    suppliedUsd: mapMorphoTimeseries(historicalState?.totalAssetsUsd),
    liquidityUsd: [],
    liquidity: [],
    apy: mapMorphoTimeseries(historicalState?.netApy, (y) => y * 100),
  };
}

export function buildV2HistorySeries(historicalState?: {
  totalAssets?: MorphoTimeseriesPoint[] | null;
  totalAssetsUsd?: MorphoTimeseriesPoint[] | null;
  avgNetApy?: MorphoTimeseriesPoint[] | null;
} | null): VaultHistorySeries {
  const totalAssetsUsd = mapMorphoTimeseries(historicalState?.totalAssetsUsd);
  const totalAssets = mapMorphoTimeseriesRaw(historicalState?.totalAssets);

  return {
    supplied: totalAssets,
    suppliedUsd: totalAssetsUsd,
    liquidityUsd: [],
    liquidity: [],
    apy: mapMorphoTimeseries(historicalState?.avgNetApy, (y) => y * 100),
  };
}
