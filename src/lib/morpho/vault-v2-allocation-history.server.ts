import { getAddress } from 'viem';
import { morphoRestGet, morphoSelector } from '@/lib/morpho/rest-client';
import {
  allocationChangesFromSupplyShares,
  marketsWithShareChanges,
  type AllocationChange,
  type MarketAllocationSeries,
  type RestMarketStatePoint,
  type RestPositionPoint,
} from '@/lib/morpho/vault-v2-allocation-history';

type RestAllocations = {
  allocations?: Array<{
    adapter_address?: string | null;
    caps?: Array<{ cap_id?: string | null; cap_type?: string | null; market_id?: string | null } | null> | null;
  } | null> | null;
};

/**
 * History, not live state: Morpho REST is rate limited per IP (~333 req/min
 * sustained, a 7-day block past 3,334 in 10 min), so this is cached for 5 min,
 * an exception to the 30s ceiling in `lib/api/response-cache.ts`.
 */
const CACHE_TTL_MS = 5 * 60_000;
/** Concurrent REST reads per vault, so a 20-market vault does not burst. */
const CONCURRENCY = 6;
const SEVEN_DAYS_S = 7 * 86_400;

const cache = new Map<string, { data: AllocationChange[]; expiresAt: number }>();
const inflight = new Map<string, Promise<AllocationChange[]>>();

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

async function load(vault: string, chainId: number): Promise<AllocationChange[]> {
  const allocations = await morphoRestGet<RestAllocations>(
    `/v0/vaults-v2/${morphoSelector(chainId, vault)}/allocations`
  );
  const markets: Array<{ capId: string; adapterAddress: string; marketId: string }> = [];
  for (const adapter of allocations.allocations ?? []) {
    if (!adapter?.adapter_address) continue;
    for (const cap of adapter.caps ?? []) {
      if (cap?.cap_type !== 'market_v1' || !cap.market_id || !cap.cap_id) continue;
      markets.push({ capId: cap.cap_id, adapterAddress: getAddress(adapter.adapter_address), marketId: cap.market_id });
    }
  }
  const marketPath = (marketId: string) => `/v0/blue/markets/${morphoSelector(chainId, marketId)}`;
  const positionPath = (m: (typeof markets)[number]) =>
    `${marketPath(m.marketId)}/users/${m.adapterAddress}/position/history`;

  // 1. One daily read per market. Most capped markets never move in 30 days.
  const daily = await mapLimit(markets, CONCURRENCY, (m) =>
    morphoRestGet<RestPositionPoint[]>(positionPath(m), { lookback: 'thirty_days' })
  );
  const moved = marketsWithShareChanges(
    markets.map((m, i) => ({ ...m, positionDaily: daily[i] ?? [] })),
    Math.floor(Date.now() / 1000) - SEVEN_DAYS_S
  );
  if (moved.length === 0) return [];

  // 2. Only markets whose share count changed: share price, plus hourly detail
  //    when the change is in the last 7 days.
  const series: MarketAllocationSeries[] = await mapLimit(moved, CONCURRENCY, async (m) => {
    const [stateDaily, positionHourly, stateHourly] = await Promise.all([
      morphoRestGet<RestMarketStatePoint[]>(`${marketPath(m.marketId)}/state/history`, { lookback: 'thirty_days' }),
      m.recent
        ? morphoRestGet<RestPositionPoint[]>(positionPath(m), { lookback: 'seven_days' })
        : Promise.resolve([] as RestPositionPoint[]),
      m.recent
        ? morphoRestGet<RestMarketStatePoint[]>(`${marketPath(m.marketId)}/state/history`, { lookback: 'seven_days' })
        : Promise.resolve([] as RestMarketStatePoint[]),
    ]);
    return {
      capId: m.capId,
      adapterAddress: m.adapterAddress,
      marketId: m.marketId,
      positionDaily: m.positionDaily,
      positionHourly: positionHourly ?? [],
      stateDaily: stateDaily ?? [],
      stateHourly: stateHourly ?? [],
    };
  });
  return allocationChangesFromSupplyShares(series);
}

/**
 * Last 30 days of net allocation changes for every Blue market the vault caps:
 * hourly for the last 7 days, daily before that. One `/allocations` read and
 * one daily position read per capped market; share prices and hourly detail
 * only for markets whose share count moved (usually 1–3 more reads each).
 * Shared by the activity feed and the allocation history. Vault V2 adapters
 * (vault → vault) are not covered; no configured vault uses one.
 */
export function fetchAllocationChanges(vaultAddress: string, chainId: number): Promise<AllocationChange[]> {
  const vault = getAddress(vaultAddress);
  const key = `${chainId}:${vault.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return Promise.resolve(hit.data);
  const pending = inflight.get(key);
  if (pending) return pending;
  const promise = load(vault, chainId)
    .then((data) => {
      cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
      return data;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}
