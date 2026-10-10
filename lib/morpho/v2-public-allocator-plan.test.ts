import { describe, expect, it } from 'vitest';
import { decodeFunctionData, getAddress, type Address } from 'viem';
import { diffPublicAllocatorEdits } from '@/lib/morpho/v2-public-allocator-plan';
import { encodeMarketParamsData } from '@/lib/morpho/v2-id-data';
import { vaultV2BluePublicAllocatorAbi } from '@/lib/onchain/abis';
import {
  encodePublicAllocatorUpdate,
  publicAllocatorWriteConfig,
} from '@/lib/onchain/public-allocator-calldata';

const VAULT = '0x89712980Cb434eF5aE4AB29349419eb976B0b496' as Address;
const ALLOCATOR = '0xAED282B8aD9257BB1272e93aE63A32A53621e412' as Address;
const ADAPTER = '0x1111111111111111111111111111111111111111';

const market = {
  loanAsset: { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' },
  collateralAsset: { address: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf' },
  oracleAddress: '0x663BECd10daE6C4A3Dcd89F1d76c1174199639B9',
  irmAddress: '0x46415998764C29aB2a25CbeA6254146D50D22687',
  lltv: '860000000000000000',
};

function row(overrides: Partial<Parameters<typeof diffPublicAllocatorEdits>[0]['markets'][number]> = {}) {
  return {
    label: 'USDC / cbBTC',
    adapterAddress: ADAPTER,
    market,
    currentAbsoluteCap: 1000n,
    nextAbsoluteCap: 1000n,
    currentCanPull: true,
    nextCanPull: true,
    ...overrides,
  };
}

describe('diffPublicAllocatorEdits', () => {
  it('keeps an unchanged draft empty', () => {
    expect(
      diffPublicAllocatorEdits({
        currentIdle: true,
        nextIdle: true,
        markets: [row()],
      })
    ).toEqual([]);
  });

  it('emits only the settings that moved, and skips a failed read', () => {
    const changes = diffPublicAllocatorEdits({
      currentIdle: null,
      nextIdle: false,
      markets: [
        row({ nextAbsoluteCap: 0n, currentCanPull: null, nextCanPull: false }),
      ],
    });
    expect(changes).toEqual([
      expect.objectContaining({ kind: 'absoluteCap', next: 0n, label: 'USDC / cbBTC' }),
    ]);
  });
});

describe('encodePublicAllocatorUpdate', () => {
  it('encodes one idle change as setCanPullFromIdle', () => {
    const changes = diffPublicAllocatorEdits({
      currentIdle: false,
      nextIdle: true,
      markets: [],
    });
    const encoded = encodePublicAllocatorUpdate(ALLOCATOR, VAULT, changes);
    const decoded = decodeFunctionData({
      abi: vaultV2BluePublicAllocatorAbi,
      data: encoded.data,
    });
    expect(encoded.to).toBe(getAddress(ALLOCATOR));
    expect(decoded.functionName).toBe('setCanPullFromIdle');
    expect(decoded.args[0]).toBe(getAddress(VAULT));
    expect(decoded.args[1]).toBe(true);
  });

  it('batches a cap and a pull permission into multicall', () => {
    const changes = diffPublicAllocatorEdits({
      currentIdle: true,
      nextIdle: true,
      markets: [row({ nextAbsoluteCap: 2500n, nextCanPull: false })],
    });
    const encoded = encodePublicAllocatorUpdate(ALLOCATOR, VAULT, changes);
    const decoded = decodeFunctionData({
      abi: vaultV2BluePublicAllocatorAbi,
      data: encoded.data,
    });
    expect(decoded.functionName).toBe('multicall');
    const inner = decoded.args[0] as readonly `0x${string}`[];
    expect(inner).toHaveLength(2);
    const cap = decodeFunctionData({ abi: vaultV2BluePublicAllocatorAbi, data: inner[0]! });
    const pull = decodeFunctionData({ abi: vaultV2BluePublicAllocatorAbi, data: inner[1]! });
    expect(cap.functionName).toBe('setAbsoluteCap');
    expect(cap.args[3]).toBe(2500n);
    expect(pull.functionName).toBe('setCanPullFromMarket');
    expect(pull.args[3]).toBe(false);
    expect(publicAllocatorWriteConfig(ALLOCATOR, VAULT, changes).functionName).toBe('multicall');
  });

  it('uses the same market params the vault cap id is built from', () => {
    const changes = diffPublicAllocatorEdits({
      currentIdle: true,
      nextIdle: true,
      markets: [row({ nextAbsoluteCap: 1n })],
    });
    const encoded = encodePublicAllocatorUpdate(ALLOCATOR, VAULT, changes);
    const decoded = decodeFunctionData({
      abi: vaultV2BluePublicAllocatorAbi,
      data: encoded.data,
    });
    const tuple = decoded.args[2] as {
      loanToken: Address;
      collateralToken: Address;
      oracle: Address;
      irm: Address;
      lltv: bigint;
    };
    expect(encodeMarketParamsData(market).length).toBeGreaterThan(2);
    expect(tuple.loanToken.toLowerCase()).toBe(market.loanAsset.address.toLowerCase());
    expect(tuple.lltv).toBe(BigInt(market.lltv));
  });
});
