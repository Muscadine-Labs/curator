import { describe, expect, it } from 'vitest';
import {
  allocationChangesFromSupplyShares,
  type MarketAllocationSeries,
} from '@/lib/morpho/vault-v2-allocation-history';

const ADAPTER = '0xC2ec18c8049ab354756304Fb8F9e45e084097972';
const H = 3600;
const D = 86400;

/** Share price 2 assets per 1e6 shares (Blue virtual shares), constant. */
const state = (timestamp: number) => ({
  timestamp,
  total_supply_assets: String(2_000_000n - 1n),
  total_supply_shares: String(1_000_000_000_000n - 1_000_000n),
});

function series(
  positionsHourly: Array<[number, string]>,
  positionsDaily: Array<[number, string]> = [],
  priceTimestamps: number[] = [0]
): MarketAllocationSeries {
  return {
    capId: '0xcap',
    adapterAddress: ADAPTER,
    marketId: '0xmarket',
    positionHourly: positionsHourly.map(([timestamp, supply_shares]) => ({ timestamp, supply_shares })),
    positionDaily: positionsDaily.map(([timestamp, supply_shares]) => ({ timestamp, supply_shares })),
    stateHourly: priceTimestamps.map(state),
    stateDaily: [],
  };
}

describe('allocationChangesFromSupplyShares', () => {
  it('prices each share change at the market share price, newest first', () => {
    const changes = allocationChangesFromSupplyShares([
      series([
        [10 * D, '1000000000'],
        [10 * D + H, '1000000000'],
        [10 * D + 2 * H, '1500000000'],
        [10 * D + 3 * H, '500000000'],
      ]),
    ]);
    // 1e6 shares = 2 assets.
    expect(changes.map((c) => [c.timestamp, c.since, c.change])).toEqual([
      [10 * D + 3 * H, 10 * D + 2 * H, '-2000'],
      [10 * D + 2 * H, 10 * D + H, '1000'],
    ]);
    expect(changes[0]).toMatchObject({ capId: '0xcap', capType: 'marketV1', adapterAddress: ADAPTER, marketId: '0xmarket' });
  });

  it('ignores intervals where only interest accrued (share count unchanged)', () => {
    expect(
      allocationChangesFromSupplyShares([series([[0, '7'], [H, '7'], [2 * H, '7']])])
    ).toEqual([]);
  });

  it('joins older daily points before the hourly ones', () => {
    const changes = allocationChangesFromSupplyShares([
      series(
        [[20 * D, '3000000'], [20 * D + H, '3000000']],
        [[1 * D, '0'], [2 * D, '1000000'], [21 * D, '999000000']]
      ),
    ]);
    // Daily 21D is inside the hourly range and dropped; 2D → 20D adds 2e6 shares.
    expect(changes.map((c) => [c.timestamp, c.change])).toEqual([
      [20 * D, '4'],
      [2 * D, '2'],
    ]);
  });

  it('skips a market with no state history', () => {
    expect(allocationChangesFromSupplyShares([series([[0, '0'], [H, '1000000']], [], [])])).toEqual([]);
  });
});
