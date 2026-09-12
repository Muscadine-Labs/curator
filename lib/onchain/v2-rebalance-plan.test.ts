import { describe, expect, it } from 'vitest';
import {
  rebalanceCallsFingerprint,
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
