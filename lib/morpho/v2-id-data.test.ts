import { describe, expect, it } from 'vitest';
import { keccak256 } from 'viem';
import type { CapInfo } from '@/app/api/vaults/[id]/governance/route';
import type { V2VaultRiskResponse } from '@/app/api/vaults/[id]/risk/route';
import {
  encodeMarketCapIdData,
  encodeMarketParamsData,
  marketParamsMatchMarketKey,
  resolveCapIdData,
} from './v2-id-data';

const ADAPTER = '0x1111111111111111111111111111111111111111';
const OTHER_ADAPTER = '0x2222222222222222222222222222222222222222';

const params = {
  loanAsset: { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' },
  collateralAsset: { address: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf' },
  oracleAddress: '0x663BECd10daE6C4A3Dcd89F1d76c1174199639B9',
  irmAddress: '0x46415998764C29aB2a25CbeA6254146D50D22687',
  lltv: '860000000000000000',
};
const marketKey = keccak256(encodeMarketParamsData(params));

function marketCap(overrides: Partial<CapInfo> = {}): CapInfo {
  return {
    type: 'MarketV1',
    absoluteCap: '1000000',
    relativeCap: '1000000000000000000',
    allocation: '0',
    adapterAddress: ADAPTER,
    marketKey,
    marketParams: params,
    ...overrides,
  };
}

function riskWith(adapterAddress: string, market: typeof params): V2VaultRiskResponse {
  return {
    vaultAddress: '0x3333333333333333333333333333333333333333',
    totalAdapterAssetsUsd: 0,
    idleAssets: null,
    idleAssetsUsd: null,
    vaultRiskScore: 0,
    vaultRiskGrade: 'F',
    vaultAsset: null,
    adapters: [{ adapterAddress, markets: [{ market }] }],
  } as unknown as V2VaultRiskResponse;
}

describe('marketParamsMatchMarketKey', () => {
  it('accepts the params that hash to the market id', () => {
    expect(marketParamsMatchMarketKey(params, marketKey)).toBe(true);
    expect(marketParamsMatchMarketKey(params, marketKey.toUpperCase().replace('0X', '0x'))).toBe(
      true
    );
  });

  it('rejects partial params that would back-fill zero addresses', () => {
    expect(marketParamsMatchMarketKey({ ...params, oracleAddress: null }, marketKey)).toBe(false);
    expect(marketParamsMatchMarketKey({ ...params, irmAddress: null }, marketKey)).toBe(false);
  });
});

describe('resolveCapIdData (market caps)', () => {
  it('encodes complete governance params with the cap adapter', () => {
    expect(resolveCapIdData(marketCap(), null)).toBe(encodeMarketCapIdData(ADAPTER, params));
  });

  it('returns null instead of the id of a market that does not exist', () => {
    const cap = marketCap({ marketParams: { ...params, oracleAddress: null } });
    expect(resolveCapIdData(cap, null)).toBeNull();
  });

  it('falls back to verified risk params, keeping the cap adapter', () => {
    const cap = marketCap({ marketParams: { ...params, irmAddress: null } });
    expect(resolveCapIdData(cap, riskWith(OTHER_ADAPTER, params))).toBe(
      encodeMarketCapIdData(ADAPTER, params)
    );
  });

  it('ignores risk params that do not hash to the cap market', () => {
    const cap = marketCap({ marketParams: null });
    const wrong = { ...params, lltv: '915000000000000000' };
    expect(resolveCapIdData(cap, riskWith(ADAPTER, wrong))).toBeNull();
  });
});
