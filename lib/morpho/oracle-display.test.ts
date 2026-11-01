import { describe, expect, it } from 'vitest';
import {
  feedFreshness,
  formatDurationShort,
  formatOraclePriceLine,
  liquidationPenaltyPct,
  oracleConstructionRows,
  oracleDeviationPct,
  wadToPct,
} from '@/lib/morpho/oracle-display';
import type { ChainlinkFeedSnapshot } from '@/lib/morpho/oracle-price';
import { parseChainlinkDirectory } from '@/lib/morpho/chainlink-feed-registry.server';

function feed(partial: Partial<ChainlinkFeedSnapshot>): ChainlinkFeedSnapshot {
  return {
    address: '0x0000000000000000000000000000000000000001',
    role: 'baseFeedOne',
    description: null,
    answer: null,
    minAnswer: null,
    maxAnswer: null,
    decimals: 8,
    updatedAt: null,
    answerHuman: null,
    minAnswerHuman: null,
    maxAnswerHuman: null,
    atMinBound: false,
    atMaxBound: false,
    registry: null,
    ...partial,
  };
}

describe('liquidationPenaltyPct', () => {
  it('matches Morpho for a 77% LLTV (7.41%)', () => {
    expect(liquidationPenaltyPct('770000000000000000')).toBeCloseTo(7.41, 2);
  });
  it('caps the incentive at 15%', () => {
    expect(liquidationPenaltyPct(0.385)).toBeCloseTo(15, 5);
    expect(liquidationPenaltyPct(0.1)).toBeCloseTo(15, 5);
  });
  it('returns null for missing LLTV', () => {
    expect(liquidationPenaltyPct(null)).toBeNull();
    expect(liquidationPenaltyPct('0')).toBeNull();
  });
});

describe('formatDurationShort', () => {
  it('formats heartbeats', () => {
    expect(formatDurationShort(86400)).toBe('1d');
    expect(formatDurationShort(3600)).toBe('1h');
    expect(formatDurationShort(1200)).toBe('20m');
    expect(formatDurationShort(27)).toBe('27s');
    expect(formatDurationShort(null)).toBe('—');
  });
});

describe('feedFreshness', () => {
  const registry = {
    name: 'PAXG / USD',
    heartbeatSeconds: 86400,
    deviationPct: 0.5,
    feedType: 'Crypto',
    productType: 'Price',
    path: 'paxg-usd',
  };
  it('is unknown without a heartbeat', () => {
    expect(feedFreshness(feed({ updatedAt: 1 }), 100)).toBe('unknown');
  });
  it('is fresh within heartbeat + 10%', () => {
    expect(feedFreshness(feed({ updatedAt: 0, registry }), 90000)).toBe('fresh');
  });
  it('is late past heartbeat + 10%', () => {
    expect(feedFreshness(feed({ updatedAt: 0, registry }), 96000)).toBe('late');
  });
});

describe('oracleConstructionRows', () => {
  it('marks a side with no feed or vault as fixed 1:1', () => {
    const rows = oracleConstructionRows({
      feeds: [feed({ role: 'baseFeedOne' })],
      baseVault: null,
      quoteVault: null,
    });
    expect(rows.collateral.map((r) => r.kind)).toEqual(['feed']);
    expect(rows.loan).toEqual([{ kind: 'fixed', side: 'loan' }]);
  });
  it('lists vault conversion before feeds', () => {
    const rows = oracleConstructionRows({
      feeds: [feed({ role: 'baseFeedOne' }), feed({ role: 'quoteFeedOne' })],
      baseVault: { address: '0xvault', conversionSample: '1' },
      quoteVault: null,
    });
    expect(rows.collateral.map((r) => r.kind)).toEqual(['vault', 'feed']);
    expect(rows.loan.map((r) => r.kind)).toEqual(['feed']);
  });
});

describe('formatting', () => {
  it('formats the oracle price line', () => {
    expect(formatOraclePriceLine(3875.4213, 'PAXG', 'USDC')).toBe('1 PAXG = 3,875.42 USDC');
    expect(formatOraclePriceLine(null, 'PAXG', 'USDC')).toBeNull();
  });
  it('converts WAD to percent', () => {
    expect(wadToPct('50000000000000000')).toBeCloseTo(5);
  });
  it('signs the oracle deviation', () => {
    expect(oracleDeviationPct(0.995)).toBeCloseTo(-0.5);
  });
});

describe('parseChainlinkDirectory', () => {
  it('indexes primary and secondary proxies', () => {
    const map = parseChainlinkDirectory([
      {
        name: 'PAXG / USD',
        heartbeat: 86400,
        threshold: 0.5,
        feedType: 'Crypto',
        path: 'paxg-usd-shared-svr',
        proxyAddress: '0xd49c546D32D5472a7F7704EC183128512a1B2fcb',
        secondaryProxyAddress: '0xAc2483950B39eEaE305Fd3a99c685bfF21733009',
        docs: { productType: 'Price' },
      },
      { name: null, proxyAddress: '0x1' },
    ]);
    expect(map.size).toBe(2);
    expect(map.get('0xd49c546d32d5472a7f7704ec183128512a1b2fcb')?.heartbeatSeconds).toBe(86400);
    expect(map.get('0xac2483950b39eeae305fd3a99c685bff21733009')?.deviationPct).toBe(0.5);
  });
  it('ignores non-arrays', () => {
    expect(parseChainlinkDirectory({}).size).toBe(0);
  });
});
