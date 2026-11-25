import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContractFunctionZeroDataError } from 'viem';

const multicall = vi.fn();
vi.mock('@/lib/onchain/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/onchain/client')>();
  return { ...actual, publicClient: { multicall: (...args: unknown[]) => multicall(...args) } };
});

const ADAPTER = '0x8b6e43cce1961d3671a39fe8d9e711e69ddd74ce';
const WALLET = '0x1111111111111111111111111111111111111111';
const PARENT = '0x9efdc9986052e058ef717c02d500ca0456d8c1cb';

async function load() {
  vi.resetModules();
  return import('@/lib/morpho/vault-adapter-holders.server');
}

describe('findVaultAdapterHolders', () => {
  beforeEach(() => multicall.mockReset());

  it('returns holders whose parentVault() is a vault, and caches settled reads', async () => {
    const { findVaultAdapterHolders } = await load();
    multicall.mockResolvedValueOnce([
      { status: 'success', result: PARENT },
      {
        status: 'failure',
        error: new ContractFunctionZeroDataError({ functionName: 'parentVault' }),
      },
    ]);
    const found = await findVaultAdapterHolders([ADAPTER, WALLET.toUpperCase().replace('0X', '0x')]);
    expect([...found]).toEqual([ADAPTER]);
    // Both answers are cached: no second read.
    expect([...(await findVaultAdapterHolders([ADAPTER, WALLET]))]).toEqual([ADAPTER]);
    expect(multicall).toHaveBeenCalledTimes(1);
  });

  it('leaves every holder in and caches nothing when the RPC fails', async () => {
    const { findVaultAdapterHolders } = await load();
    multicall.mockRejectedValueOnce(new Error('rpc down'));
    expect((await findVaultAdapterHolders([ADAPTER])).size).toBe(0);
    multicall.mockResolvedValueOnce([{ status: 'success', result: PARENT }]);
    expect([...(await findVaultAdapterHolders([ADAPTER]))]).toEqual([ADAPTER]);
  });

  it('treats a zero parentVault as not an adapter', async () => {
    const { findVaultAdapterHolders } = await load();
    multicall.mockResolvedValueOnce([
      { status: 'success', result: '0x0000000000000000000000000000000000000000' },
    ]);
    expect((await findVaultAdapterHolders([ADAPTER])).size).toBe(0);
  });
});
