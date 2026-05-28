import {
  computeSharePriceUsdSeries,
  mapMorphoTimeseries,
} from '../vault-history';
import { normalizeVaultHistoryResponse } from '@/lib/hooks/useVaultHistory';

describe('computeSharePriceUsdSeries', () => {
  it('derives USD per share from TVL and raw total supply', () => {
    const totalAssetsUsd = [{ date: '2026-01-01T00:00:00.000Z', value: 1000 }];
    const totalSupply = [{ date: '2026-01-01T00:00:00.000Z', value: '500000000000000000000' }];

    const result = computeSharePriceUsdSeries(totalAssetsUsd, totalSupply, 18);
    expect(result).toHaveLength(1);
    expect(result[0]?.value).toBeCloseTo(2, 5);
  });
});

describe('normalizeVaultHistoryResponse', () => {
  it('fills missing share price series from stale cache', () => {
    const normalized = normalizeVaultHistoryResponse({
      vaultAddress: '0xabc',
      version: 'v2',
      assetSymbol: 'USDC',
      assetDecimals: 6,
      liquidityHistoricalAvailable: false,
      series: {
        supplied: [],
        suppliedUsd: [],
        liquidityUsd: [],
        liquidity: [],
        apy: [],
      } as never,
    });
    expect(normalized.series.sharePrice).toEqual([]);
    expect(normalized.series.sharePriceUsd).toEqual([]);
  });
});

describe('mapMorphoTimeseries share price', () => {
  it('preserves human-decimal share prices from Morpho', () => {
    const points = mapMorphoTimeseries([{ x: 1_700_000_000, y: 1.05 }]);
    expect(points[0]?.value).toBe(1.05);
  });
});
