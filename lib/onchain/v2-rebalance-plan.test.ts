import { describe, expect, it } from 'vitest';
import {
  applySubmitTimeSurplus,
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
