import { describe, expect, it } from 'vitest';
import { keccak256 } from 'viem';
import { buildLiquidityAdapterOptions } from '@/lib/morpho/vault-v2-liquidity';
import { encodeMarketParamsData } from '@/lib/morpho/v2-id-data';
import type { V2VaultRiskResponse } from '@/app/api/vaults/[id]/risk/route';
import type { VaultV2GovernanceResponse } from '@/app/api/vaults/[id]/governance/route';

const ADAPTER = '0x00000000000000000000000000000000000000aa';
const params = {
  loanAsset: { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', symbol: 'USDC' },
  collateralAsset: { address: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf', symbol: 'cbBTC' },
  oracleAddress: '0x663BECd10daE6C4A3Dcd89F1d76c1174199639B9',
  irmAddress: '0x46415998764C29aB2a25CbeA6254146D50D22687',
  lltv: '860000000000000000',
};
const marketKey = keccak256(encodeMarketParamsData(params));

function governance(caps: unknown[]): VaultV2GovernanceResponse {
  return { caps, liquidityAdapter: null, liquidityData: null } as unknown as VaultV2GovernanceResponse;
}

describe('buildLiquidityAdapterOptions', () => {
  it('offers a market whose params hash to its id', () => {
    const options = buildLiquidityAdapterOptions(
      { adapters: [] } as unknown as V2VaultRiskResponse,
      governance([{ type: 'MarketV1', adapterAddress: ADAPTER, marketKey, marketParams: params }])
    );
    expect(options).toHaveLength(1);
    expect(options[0].liquidityData).toBe(encodeMarketParamsData(params));
  });

  it('never offers zero-filled params (would brick deposits and withdrawals)', () => {
    const partial = { ...params, oracleAddress: null };
    const options = buildLiquidityAdapterOptions(
      { adapters: [] } as unknown as V2VaultRiskResponse,
      governance([{ type: 'MarketV1', adapterAddress: ADAPTER, marketKey, marketParams: partial }])
    );
    expect(options).toHaveLength(0);
  });
});
