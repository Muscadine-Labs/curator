import { maxUint256 } from 'viem';
import {
  buildV1ReallocationPlan,
  type ReallocationTarget,
} from '../reallocation';
import type { MarketParams } from '../vault-writes';

const MARKET_PARAMS: MarketParams = {
  loanToken: '0x0000000000000000000000000000000000000001',
  collateralToken: '0x0000000000000000000000000000000000000002',
  oracle: '0x0000000000000000000000000000000000000003',
  irm: '0x0000000000000000000000000000000000000004',
  lltv: 860000000000000000n,
};

describe('buildV1ReallocationPlan', () => {
  const getParams = () => MARKET_PARAMS;

  it('places withdrawals before deposits and uses maxUint256 catcher on largest deposit by default', () => {
    const targets: ReallocationTarget[] = [
      { key: 'a', assets: 500n, current: 1000n },
      { key: 'b', assets: 2000n, current: 1000n },
      { key: 'c', assets: 1500n, current: 1000n },
    ];

    const plan = buildV1ReallocationPlan(targets, getParams);
    expect(plan.withdrawalCount).toBe(1);
    expect(plan.depositCount).toBe(2);
    expect(plan.catcherUsed).toBe(true);
    expect(plan.allocations[0].marketParams).toEqual(MARKET_PARAMS);
    expect(plan.allocations[0].assets).toBe(500n);
    expect(plan.allocations[1].assets).toBe(1500n);
    expect(plan.allocations[2].assets).toBe(maxUint256);
  });

  it('uses an explicit catcherKey for maxUint256 even when it is not the largest deposit', () => {
    const targets: ReallocationTarget[] = [
      { key: 'a', assets: 500n, current: 1000n },
      { key: 'b', assets: 2000n, current: 1000n },
      { key: 'c', assets: 1100n, current: 1000n },
    ];

    const plan = buildV1ReallocationPlan(targets, getParams, { catcherKey: 'c' });
    expect(plan.allocations.length).toBe(3);
    expect(plan.allocations[0].assets).toBe(500n);
    expect(plan.allocations[1].assets).toBe(2000n);
    expect(plan.allocations[2].assets).toBe(maxUint256);
    expect(plan.catcherUsed).toBe(true);
  });
});
