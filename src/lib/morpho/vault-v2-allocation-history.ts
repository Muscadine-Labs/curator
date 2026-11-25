/**
 * Allocation changes rebuilt from Morpho REST history.
 *
 * Morpho GraphQL removes `vaultV2AllocationTransactions` on 2026-12-02 and REST
 * has no vault-wide transaction list. A Blue market adapter's **supply shares**
 * in a market only change when the vault allocates or deallocates (interest
 * raises the share price, not the share count), so the share change between
 * two history points, priced at that point's market share price, is the net
 * amount moved in that interval. Cap history (`/caps/history`) is not used: it
 * reports the live position, so every interval would show accrued interest.
 *
 * There is no tx hash or sender, and several moves inside one interval show as
 * one net change.
 */

export type RestPositionPoint = { timestamp?: number | null; supply_shares?: string | null };
export type RestMarketStatePoint = {
  timestamp?: number | null;
  total_supply_assets?: string | null;
  total_supply_shares?: string | null;
};

export type MarketAllocationSeries = {
  capId: string;
  adapterAddress: string;
  marketId: string;
  /** Adapter's position in the market: daily (older) and hourly (recent) points. */
  positionDaily: readonly RestPositionPoint[];
  positionHourly: readonly RestPositionPoint[];
  /** Market totals for the share price: same lookbacks. */
  stateDaily: readonly RestMarketStatePoint[];
  stateHourly: readonly RestMarketStatePoint[];
};

export type AllocationChange = {
  /** End of the interval in which the change happened (unix seconds). */
  timestamp: number;
  /** Start of that interval (the previous history point). */
  since: number;
  capId: string;
  capType: 'marketV1';
  adapterAddress: string;
  marketId: string;
  /** Signed raw asset change (+ allocate, − deallocate). */
  change: string;
};

function toBigInt(value: string | null | undefined): bigint | null {
  if (value == null || value === '') return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

/** Daily points before the first hourly point, then the hourly points, sorted. */
function joined<T extends { timestamp?: number | null }>(
  daily: readonly T[],
  hourly: readonly T[]
): Array<T & { timestamp: number }> {
  const clean = (points: readonly T[]) =>
    points
      .filter((p): p is T & { timestamp: number } => Number.isFinite(Number(p?.timestamp)))
      .map((p) => ({ ...p, timestamp: Number(p.timestamp) }))
      .sort((a, b) => a.timestamp - b.timestamp);
  const recent = clean(hourly);
  const start = recent[0]?.timestamp ?? Infinity;
  return [...clean(daily).filter((p) => p.timestamp < start), ...recent];
}

/** Morpho Blue: assets = shares × (totalAssets + 1) / (totalShares + 1e6), rounded down. */
const VIRTUAL_ASSETS = 1n;
const VIRTUAL_SHARES = 1_000_000n;

function sharesToAssets(shares: bigint, state: RestMarketStatePoint): bigint | null {
  const assets = toBigInt(state.total_supply_assets);
  const totalShares = toBigInt(state.total_supply_shares);
  if (assets == null || totalShares == null) return null;
  const negative = shares < 0n;
  const abs = negative ? -shares : shares;
  const value = (abs * (assets + VIRTUAL_ASSETS)) / (totalShares + VIRTUAL_SHARES);
  return negative ? -value : value;
}

/** Market state at `timestamp`, else the latest one before it. */
function stateAt(
  states: ReadonlyArray<RestMarketStatePoint & { timestamp: number }>,
  timestamp: number
): (RestMarketStatePoint & { timestamp: number }) | null {
  let found: (RestMarketStatePoint & { timestamp: number }) | null = null;
  for (const state of states) {
    if (state.timestamp > timestamp) break;
    found = state;
  }
  return found ?? states[0] ?? null;
}

/** Net allocation changes per interval, newest first. */
export function allocationChangesFromSupplyShares(
  series: readonly MarketAllocationSeries[]
): AllocationChange[] {
  const out: AllocationChange[] = [];
  for (const market of series) {
    const positions = joined(market.positionDaily, market.positionHourly)
      .map((p) => ({ timestamp: p.timestamp, shares: toBigInt(p.supply_shares) }))
      .filter((p): p is { timestamp: number; shares: bigint } => p.shares !== null);
    const states = joined(market.stateDaily, market.stateHourly);
    if (states.length === 0) continue;
    for (let i = 1; i < positions.length; i++) {
      const delta = positions[i].shares - positions[i - 1].shares;
      if (delta === 0n) continue;
      const state = stateAt(states, positions[i].timestamp);
      const change = state ? sharesToAssets(delta, state) : null;
      if (change == null || change === 0n) continue;
      out.push({
        timestamp: positions[i].timestamp,
        since: positions[i - 1].timestamp,
        capId: market.capId,
        capType: 'marketV1',
        adapterAddress: market.adapterAddress,
        marketId: market.marketId,
        change: change.toString(),
      });
    }
  }
  return out.sort((a, b) => b.timestamp - a.timestamp || a.capId.localeCompare(b.capId));
}
