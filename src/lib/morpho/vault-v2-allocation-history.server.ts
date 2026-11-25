import { getAddress } from 'viem';
import { withServerResponseCache } from '@/lib/api/server-response-cache';
import { API_CACHE_MAX_AGE_MS } from '@/lib/api/response-cache';
import { morphoRestGet, morphoSelector } from '@/lib/morpho/rest-client';
import {
  allocationChangesFromSupplyShares,
  type AllocationChange,
  type MarketAllocationSeries,
  type RestMarketStatePoint,
  type RestPositionPoint,
} from '@/lib/morpho/vault-v2-allocation-history';

type RestAllocations = {
  allocations?: Array<{
    adapter_address?: string | null;
    adapter_kind?: string | null;
    caps?: Array<{ cap_id?: string | null; cap_type?: string | null; market_id?: string | null } | null> | null;
  } | null> | null;
};

/**
 * Last 30 days of net allocation changes for every Blue market the vault caps
 * (hourly for 7 days, daily before that). Four REST reads per market (position
 * and market state, two lookbacks), shared by the activity feed and the
 * allocation history for 30s. Vault V2 adapters (vault → vault) are not
 * covered; no configured vault uses one.
 */
export function fetchAllocationChanges(
  vaultAddress: string,
  chainId: number
): Promise<AllocationChange[]> {
  const vault = getAddress(vaultAddress);
  return withServerResponseCache(
    `vault-allocation-changes:${chainId}:${vault.toLowerCase()}`,
    API_CACHE_MAX_AGE_MS,
    async () => {
      const allocations = await morphoRestGet<RestAllocations>(
        `/v0/vaults-v2/${morphoSelector(chainId, vault)}/allocations`
      );
      const markets: Array<{ capId: string; adapterAddress: string; marketId: string }> = [];
      for (const adapter of allocations.allocations ?? []) {
        if (!adapter?.adapter_address) continue;
        for (const cap of adapter.caps ?? []) {
          if (cap?.cap_type !== 'market_v1' || !cap.market_id || !cap.cap_id) continue;
          markets.push({
            capId: cap.cap_id,
            adapterAddress: getAddress(adapter.adapter_address),
            marketId: cap.market_id,
          });
        }
      }

      const series: MarketAllocationSeries[] = await Promise.all(
        markets.map(async (market) => {
          const marketPath = `/v0/blue/markets/${morphoSelector(chainId, market.marketId)}`;
          const positionPath = `${marketPath}/users/${market.adapterAddress}/position/history`;
          const [positionDaily, positionHourly, stateDaily, stateHourly] = await Promise.all([
            morphoRestGet<RestPositionPoint[]>(positionPath, { lookback: 'thirty_days' }),
            morphoRestGet<RestPositionPoint[]>(positionPath, { lookback: 'seven_days' }),
            morphoRestGet<RestMarketStatePoint[]>(`${marketPath}/state/history`, { lookback: 'thirty_days' }),
            morphoRestGet<RestMarketStatePoint[]>(`${marketPath}/state/history`, { lookback: 'seven_days' }),
          ]);
          return {
            ...market,
            positionDaily: positionDaily ?? [],
            positionHourly: positionHourly ?? [],
            stateDaily: stateDaily ?? [],
            stateHourly: stateHourly ?? [],
          };
        })
      );
      return allocationChangesFromSupplyShares(series);
    }
  );
}
