import { describe, expect, it } from 'vitest';
import {
  applySubmitTimeSurplus,
  buildRebalanceMulticallData,
  deallocateAmountForRow,
  summarizeRebalanceFunding,
  percentInputToRaw,
  rawToPercentInput,
  rebalanceCallsFingerprint,
  shiftTargetToLiveCurrent,
  snapUnchangedTargetsToLiveCurrent,
  type RebalancePlanRow,
} from '@/lib/onchain/v2-rebalance-plan';

const ADAPTER = '0x0000000000000000000000000000000000000001';

function row(
  assets: bigint,
  current: bigint,
  extra?: Partial<RebalancePlanRow['target']>
): RebalancePlanRow {
  return {
    target: {
      label: 'market',
      adapterAddress: ADAPTER,
      data: '0x',
      isVaultIdle: false,
      absoluteCapRaw: null,
      relativeCapWad: null,
      ...extra,
    },
    assets,
    current,
  };
}

describe('snapUnchangedTargetsToLiveCurrent', () => {
  it('keeps an untouched row as a no-op when live current drifted', () => {
    const snapped = snapUnchangedTargetsToLiveCurrent(row(100n, 100n), 108n);
    expect(snapped.current).toBe(108n);
    expect(snapped.assets).toBe(108n);
  });

  it('preserves an edited target when live current drifted', () => {
    const snapped = snapUnchangedTargetsToLiveCurrent(row(150n, 100n), 108n);
    expect(snapped.current).toBe(108n);
    expect(snapped.assets).toBe(150n);
  });
});

describe('rebalanceCallsFingerprint', () => {
  it('is unchanged when snapping an untouched row', () => {
    const planned = [row(100n, 100n), row(50n, 40n)];
    const afterRefresh = [
      snapUnchangedTargetsToLiveCurrent(planned[0]!, 108n),
      snapUnchangedTargetsToLiveCurrent(planned[1]!, 40n),
    ];
    expect(rebalanceCallsFingerprint(afterRefresh)).toBe(rebalanceCallsFingerprint(planned));
  });

  it('changes when an edited row’s live current changes the delta', () => {
    const planned = [row(150n, 100n)];
    const afterRefresh = [snapUnchangedTargetsToLiveCurrent(planned[0]!, 110n)];
    expect(rebalanceCallsFingerprint(afterRefresh)).not.toBe(
      rebalanceCallsFingerprint(planned)
    );
  });
});

describe('shiftTargetToLiveCurrent (idle row)', () => {
  it('re-anchors a planned idle increase on live cash', () => {
    // GraphQL said 1,000 idle; plan deallocates 50,000 → idle target 51,000.
    // Live cash is only 200 (idle was deployed since the indexer snapshot).
    const shifted = shiftTargetToLiveCurrent(row(51_000n, 1_000n, { isVaultIdle: true }), 200n);
    expect(shifted.current).toBe(200n);
    expect(shifted.assets).toBe(50_200n);
  });

  it('keeps an untouched idle row a no-op and never goes negative', () => {
    expect(shiftTargetToLiveCurrent(row(1_000n, 1_000n, { isVaultIdle: true }), 900n).assets).toBe(900n);
    expect(shiftTargetToLiveCurrent(row(0n, 1_000n, { isVaultIdle: true }), 400n).assets).toBe(0n);
  });

  it('stops a stale idle snapshot from exceeding the chain total', () => {
    const plan = [
      row(50_000n, 100_000n),
      shiftTargetToLiveCurrent(row(51_000n, 1_000n, { isVaultIdle: true }), 200n),
    ];
    // Chain total = 100,000 booked + 200 idle.
    expect(applySubmitTimeSurplus(plan, 100_200n).error).toBeNull();
  });
});

describe('percent inputs', () => {
  it('round-trips a rounded-down row below its booked amount', () => {
    const total = 1_000_000_000_000n; // 1,000,000 USDC
    const booked = 333_333_333_333n;
    const pct = rawToPercentInput(booked, total);
    expect(pct).toBe('33.33');
    // Resolving the string alone loses 33.33 USDC — the allocation UI therefore
    // maps an unchanged percent string back to the booked amount.
    expect(percentInputToRaw(pct, total).assets).toBe(333_300_000_000n);
  });
});

describe('deallocateAmountForRow (accrued interest)', () => {
  // Booked allocation(id) 100, live adapter position 105 (5 of unbooked interest).
  const live = { liveAssets: 105n, displayAssets: 105n };

  it('withdraws the live position on a full exit, not just the booked amount', () => {
    expect(deallocateAmountForRow({ ...row(0n, 100n, live), displayTarget: 0n })).toBe(105n);
  });

  it('withdraws down to a target that sits inside the accrued interest', () => {
    expect(deallocateAmountForRow({ ...row(0n, 100n, live), displayTarget: 3n })).toBe(102n);
  });

  it('keeps booked deltas when the target is above the interest', () => {
    expect(deallocateAmountForRow(row(40n, 100n, live))).toBe(60n);
  });

  it('falls back to booked when the live position was not read on-chain', () => {
    expect(
      deallocateAmountForRow({ ...row(0n, 100n, { displayAssets: 105n }), displayTarget: 0n })
    ).toBe(100n);
  });

  it('never deallocates for raised, unchanged, or idle rows', () => {
    expect(deallocateAmountForRow(row(120n, 100n, live))).toBe(0n);
    expect(deallocateAmountForRow(row(100n, 100n, live))).toBe(0n);
    expect(
      deallocateAmountForRow({ ...row(0n, 100n, { ...live, isVaultIdle: true }), displayTarget: 0n })
    ).toBe(0n);
  });

  it('flows into calldata and funding', () => {
    const exit = { ...row(0n, 100n, live), displayTarget: 0n };
    const { deallocCalls } = buildRebalanceMulticallData([exit]);
    expect(deallocCalls).toHaveLength(1);
    // amount is the last 32-byte word of deallocate(address,bytes,uint256) with empty data
    expect(BigInt(`0x${deallocCalls[0]!.slice(2 + 8 + 64 * 2, 2 + 8 + 64 * 3)}`)).toBe(105n);
    expect(summarizeRebalanceFunding([exit], 0n).deallocateSum).toBe(105n);
  });

  it('drops the live-space target when booked moved since load', () => {
    const exit = { ...row(0n, 100n, live), displayTarget: 0n };
    expect(snapUnchangedTargetsToLiveCurrent(exit, 100n).displayTarget).toBe(0n);
    const moved = snapUnchangedTargetsToLiveCurrent(exit, 90n);
    expect(moved.displayTarget).toBeUndefined();
    expect(deallocateAmountForRow(moved)).toBe(90n);
  });
});
