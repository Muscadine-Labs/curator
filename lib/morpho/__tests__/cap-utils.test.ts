import { computeCapUtilizationPercent, isAdapterCap, isMarketCap } from '@/lib/morpho/cap-utils';
import type { CapInfo } from '@/app/api/vaults/v2/[id]/governance/route';

describe('cap-utils', () => {
  it('recognizes Morpho GraphQL cap types', () => {
    expect(isAdapterCap({ type: 'Adapter', absoluteCap: '1', relativeCap: '1', allocation: '0' })).toBe(true);
    expect(isMarketCap({ type: 'MarketV1', absoluteCap: '1', relativeCap: '1', allocation: '0', marketKey: '0x' })).toBe(true);
    expect(isAdapterCap({ type: 'adapter', absoluteCap: '1', relativeCap: '1', allocation: '0', adapterAddress: '0x1' })).toBe(true);
  });

  it('computes cap utilization from absolute caps', () => {
    const caps: CapInfo[] = [
      { type: 'Adapter', absoluteCap: '1000', relativeCap: '0', allocation: '250' },
      { type: 'MarketV1', absoluteCap: '1000', relativeCap: '0', allocation: '750', marketKey: 'm' },
    ];
    expect(computeCapUtilizationPercent(caps)).toBe(50);
  });
});
