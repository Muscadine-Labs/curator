import { useQuery } from '@tanstack/react-query';
import { apiFetch, apiErrorMessage } from '@/lib/data/api-fetch';
import {
  CURATOR_REFETCH_INTERVAL_MS,
  DASHBOARD_QUERY_OPTIONS,
  ON_CHAIN_VAULT_QUERY_OPTIONS,
} from '@/lib/data/query-config';
import type { CuratorMarketDetail, CuratorMarketListItem } from '@/lib/morpho/curator-markets';
import type {
  MidnightMarketDetail,
  MidnightMarketListItem,
} from '@/lib/morpho/midnight-markets';
import { BASE_CHAIN_ID } from '@/lib/constants';
import type { MarketActivity } from '@/lib/morpho/market-activity.server';

type CuratorMarketsResponse = {
  chainId: number;
  markets: CuratorMarketListItem[];
};

type CuratorMarketDetailResponse = {
  market: CuratorMarketDetail;
};

async function fetchCuratorMarkets(chainId: number): Promise<CuratorMarketsResponse> {
  const res = await apiFetch(`/api/markets?chainId=${chainId}`);
  if (!res.ok) {
    throw new Error(await apiErrorMessage(res, 'Failed to fetch markets'));
  }
  return res.json();
}

async function fetchCuratorMarketDetail(
  marketId: string,
  chainId: number
): Promise<CuratorMarketDetailResponse> {
  const res = await apiFetch(
    `/api/markets/${encodeURIComponent(marketId)}?chainId=${chainId}`
  );
  if (!res.ok) {
    throw new Error(await apiErrorMessage(res, 'Failed to fetch market'));
  }
  return res.json();
}

export function useCuratorMarkets(
  chainId: number = BASE_CHAIN_ID,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: ['curator-markets', chainId],
    queryFn: () => fetchCuratorMarkets(chainId),
    ...DASHBOARD_QUERY_OPTIONS,
    enabled: options?.enabled ?? true,
  });
}

export function useCuratorMarketDetail(
  marketId: string | null | undefined,
  chainId: number = BASE_CHAIN_ID
) {
  return useQuery({
    queryKey: ['curator-market', chainId, marketId],
    queryFn: () => {
      if (!marketId) throw new Error('Market id is required');
      return fetchCuratorMarketDetail(marketId, chainId);
    },
    enabled: Boolean(marketId),
    ...ON_CHAIN_VAULT_QUERY_OPTIONS,
    // The oracle panel's clock ticks every 30s; without refreshing the feed
    // snapshot alongside it, healthy feeds would turn Late on an open page.
    refetchInterval: CURATOR_REFETCH_INTERVAL_MS,
  });
}

export function useMidnightMarketDetail(
  marketId: string | null | undefined,
  chainId: number = BASE_CHAIN_ID
) {
  return useQuery({
    queryKey: ['midnight-market', chainId, marketId],
    queryFn: async (): Promise<{ market: MidnightMarketDetail }> => {
      if (!marketId) throw new Error('Market id is required');
      const res = await apiFetch(
        `/api/markets/midnight/${encodeURIComponent(marketId)}?chainId=${chainId}`
      );
      if (!res.ok) {
        throw new Error(await apiErrorMessage(res, 'Failed to fetch Midnight market'));
      }
      return res.json();
    },
    enabled: Boolean(marketId),
    ...DASHBOARD_QUERY_OPTIONS,
  });
}

type MidnightMarketsResponse = {
  chainId: number;
  markets: MidnightMarketListItem[];
  /** Set when the server cut the list short (page cap). */
  warning?: string | null;
};

export function useMidnightMarkets(
  chainId: number = BASE_CHAIN_ID,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: ['midnight-markets', chainId],
    queryFn: async (): Promise<MidnightMarketsResponse> => {
      const res = await apiFetch(`/api/markets/midnight?chainId=${chainId}`);
      if (!res.ok) {
        throw new Error(await apiErrorMessage(res, 'Failed to fetch Midnight markets'));
      }
      return res.json();
    },
    ...DASHBOARD_QUERY_OPTIONS,
    enabled: options?.enabled ?? true,
  });
}

/** Borrowers, suppliers, liquidations, listing vaults, rate history, IRM curve. */
export function useCuratorMarketActivity(
  marketId: string | null | undefined,
  chainId: number = BASE_CHAIN_ID
) {
  return useQuery({
    queryKey: ['curator-market-activity', chainId, marketId],
    queryFn: async (): Promise<MarketActivity> => {
      if (!marketId) throw new Error('Market id is required');
      const res = await apiFetch(
        `/api/markets/${encodeURIComponent(marketId)}/activity?chainId=${chainId}`
      );
      if (!res.ok) {
        throw new Error(await apiErrorMessage(res, 'Failed to fetch market activity'));
      }
      const body = (await res.json()) as { activity: MarketActivity };
      return body.activity;
    },
    ...DASHBOARD_QUERY_OPTIONS,
    enabled: Boolean(marketId),
  });
}
