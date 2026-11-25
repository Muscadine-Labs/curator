import { clearMorphoRestCache } from '@/lib/morpho/rest-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CapInfo } from '@/app/api/vaults/[id]/governance/route';
import {
  fetchCollateralCapsRest,
  withRestCollateralCaps,
} from '@/lib/morpho/vault-v2-collateral-caps.server';

const VAULT = '0x314fD07319ef645bA7D548915CCd91F4788A1839';
const CBBTC = '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf';

afterEach(() => {
  vi.unstubAllGlobals();
  clearMorphoRestCache();
});

function stubFetch(body: unknown, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('fetchCollateralCapsRest', () => {
  it('maps REST collateral caps, deduped by cap id, ignoring other cap types', async () => {
    const collateral = {
      cap_id: '0xabc',
      cap_type: 'collateral',
      absolute_cap: '1000',
      relative_cap_wad: '1000000000000000000',
      allocated_assets: '10',
      collateral_address: CBBTC.toLowerCase(),
    };
    const fetchMock = stubFetch({
      data: {
        allocations: [{ caps: [{ cap_id: '0xm', cap_type: 'market_v1' }, collateral] }],
        unscoped_caps: [collateral],
      },
    });
    const caps = await fetchCollateralCapsRest(VAULT, 8453);
    expect(caps).toEqual([
      {
        type: 'Collateral',
        absoluteCap: '1000',
        relativeCap: '1000000000000000000',
        allocation: '10',
        collateralAddress: CBBTC,
      },
    ]);
    expect(String(fetchMock.mock.calls[0][0])).toContain(`/v0/vaults-v2/8453:${VAULT}/allocations`);
  });

  it('throws on an HTTP error instead of returning no caps', async () => {
    stubFetch({}, 500);
    await expect(fetchCollateralCapsRest(VAULT, 8453)).rejects.toThrow('HTTP 500');
  });
});

describe('withRestCollateralCaps', () => {
  const market: CapInfo = { type: 'MarketV1', absoluteCap: '1', relativeCap: '1', allocation: '0', marketKey: '0x1' };
  const graphCollateral: CapInfo = { type: 'Collateral', absoluteCap: '1', relativeCap: '1', allocation: '0' };
  const restCollateral: CapInfo = { ...graphCollateral, collateralAddress: CBBTC };

  it('replaces GraphQL collateral caps with the REST ones', () => {
    expect(withRestCollateralCaps([market, graphCollateral], [restCollateral])).toEqual([
      market,
      restCollateral,
    ]);
  });

  it('keeps GraphQL caps when the REST read failed', () => {
    expect(withRestCollateralCaps([market, graphCollateral], null)).toEqual([market, graphCollateral]);
  });
});
