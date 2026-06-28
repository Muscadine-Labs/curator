import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/data/api-fetch';
import { DASHBOARD_QUERY_OPTIONS, ON_CHAIN_VAULT_QUERY_OPTIONS } from '@/lib/data/query-config';
import type { CuratorMarketDetail, CuratorMarketListItem } from '@/lib/morpho/curator-markets';
import { BASE_CHAIN_ID } from '@/lib/constants';

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
    const json = await res.json().catch(() => ({}));
    throw new Error(json.message || json.error || 'Failed to fetch markets');
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
    const json = await res.json().catch(() => ({}));
    throw new Error(json.message || json.error || 'Failed to fetch market');
  }
  return res.json();
}

export function useCuratorMarkets(chainId: number = BASE_CHAIN_ID) {
  return useQuery({
    queryKey: ['curator-markets', chainId],
    queryFn: () => fetchCuratorMarkets(chainId),
    ...DASHBOARD_QUERY_OPTIONS,
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
  });
}
