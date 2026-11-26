import { clearMorphoRestCache } from '@/lib/morpho/rest-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, toFunctionSelector } from 'viem';
import { vaultV2Abi } from '@/lib/onchain/abis';

const getTransactionReceipt = vi.fn();
const multicall = vi.fn();
vi.mock('@/lib/onchain/client', () => ({
  publicClient: {
    getTransactionReceipt: (...a: unknown[]) => getTransactionReceipt(...a),
    multicall: (...a: unknown[]) => multicall(...a),
  },
}));

vi.mock('@/lib/api/server-response-cache', () => ({
  withServerResponseCache: <T,>(_key: string, _ttl: number, loader: () => Promise<T>) => loader(),
}));

import { fetchVaultPendingSubmits } from '@/lib/morpho/vault-v2-pending.server';

const VAULT = '0x314fD07319ef645bA7D548915CCd91F4788A1839';
const OTHER_VAULT = '0x99dcd0d75822ba398f13b2a8852b07c7e137ec70';
const TX = '0x3e28fdeadfc34dd422214e4c1aa18cb884df538fb7f7bd0d27d34cbc051b9cc2';

function submitLog(address: string, data: `0x${string}`, executableAt: bigint) {
  return {
    address,
    topics: encodeEventTopics({ abi: vaultV2Abi, eventName: 'Submit', args: { selector: data.slice(0, 10) as `0x${string}` } }),
    data: encodeAbiParameters([{ type: 'bytes' }, { type: 'uint256' }], [data, executableAt]),
  };
}

const idData = encodeAbiParameters([{ type: 'string' }, { type: 'address' }], ['collateralToken', VAULT]);
const capData = encodeFunctionData({ abi: vaultV2Abi, functionName: 'increaseAbsoluteCap', args: [idData, 5n] });
const feeData = encodeFunctionData({ abi: vaultV2Abi, functionName: 'setPerformanceFee', args: [1n] });

beforeEach(() => {
  clearMorphoRestCache();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ submitted_transaction_hash: TX, executable_at_timestamp: 100 }], cursor: null }),
    })
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  getTransactionReceipt.mockReset();
  multicall.mockReset();
});

describe('fetchVaultPendingSubmits', () => {
  it('reads calldata from this vault’s Submit events and keeps what is still pending on chain', async () => {
    getTransactionReceipt.mockResolvedValue({
      transactionHash: TX,
      logs: [
        submitLog(VAULT, capData, 100n),
        submitLog(OTHER_VAULT, capData, 100n),
        submitLog(VAULT, feeData, 100n),
      ],
    });
    // capData still pending, feeData already accepted (executableAt 0).
    multicall.mockResolvedValue([100n, 0n]);
    const pending = await fetchVaultPendingSubmits(VAULT, 8453);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      data: capData,
      functionName: 'increaseAbsoluteCap',
      txHash: TX,
      validAt: 100,
      decoded: { type: 'IncreaseCap', cap: '5', capType: 'Collateral' },
    });
    expect(toFunctionSelector('increaseAbsoluteCap(bytes,uint256)')).toBe(capData.slice(0, 10));
  });

  it('throws when a receipt cannot be read, instead of returning a short list', async () => {
    getTransactionReceipt.mockRejectedValue(new Error('rpc down'));
    await expect(fetchVaultPendingSubmits(VAULT, 8453)).rejects.toThrow('rpc down');
  });

  it('returns nothing when REST lists no pending actions', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: [], cursor: null }) })
    );
    expect(await fetchVaultPendingSubmits(VAULT, 8453)).toEqual([]);
    expect(getTransactionReceipt).not.toHaveBeenCalled();
  });
});
