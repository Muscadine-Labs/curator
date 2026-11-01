import { describe, expect, it } from 'vitest';
import { encodeFunctionData, encodePacked, type Hex } from 'viem';
import { vaultV2Abi } from '@/lib/onchain/abis';
import {
  activityRoles,
  describeVaultCall,
  governanceCallsFromSafeTx,
  matchPendingConfig,
  pendingStatus,
  signedAllocationAmount,
  sortActivity,
  type VaultActivityRow,
} from '@/lib/morpho/vault-activity';
import { summarizeAdapter } from '@/lib/morpho/vault-adapter-summary';

const VAULT = '0x314fD07319ef645bA7D548915CCd91F4788A1839';
const OTHER = '0x0000000000000000000000000000000000000001';
const MULTI_SEND_CALL_ONLY = '0x9641d764fc13c8B624c04430C7356C1C7C8102e2';

const setMaxRate = encodeFunctionData({ abi: vaultV2Abi, functionName: 'setMaxRate', args: [1n] });
const submitMaxRate = encodeFunctionData({ abi: vaultV2Abi, functionName: 'submit', args: [setMaxRate] });
const allocate = encodeFunctionData({
  abi: vaultV2Abi,
  functionName: 'allocate',
  args: [OTHER, '0x', 1n],
});

function multiSend(calls: Array<{ to: string; data: Hex }>): Hex {
  const packed = calls
    .map((c) =>
      encodePacked(
        ['uint8', 'address', 'uint256', 'uint256', 'bytes'],
        [0, c.to as Hex, 0n, BigInt((c.data.length - 2) / 2), c.data]
      ).slice(2)
    )
    .join('');
  return encodeFunctionData({
    abi: [
      {
        type: 'function',
        name: 'multiSend',
        stateMutability: 'payable',
        inputs: [{ name: 'transactions', type: 'bytes' }],
        outputs: [],
      },
    ],
    functionName: 'multiSend',
    args: [`0x${packed}`],
  });
}

describe('describeVaultCall', () => {
  it('names direct and submitted calls', () => {
    expect(describeVaultCall(setMaxRate)).toBe('setMaxRate');
    expect(describeVaultCall(submitMaxRate)).toBe('Submit setMaxRate');
    expect(describeVaultCall('0xdeadbeef')).toBeNull();
    expect(describeVaultCall(null)).toBeNull();
  });
});

const actions = (calls: Array<{ action: string }>) => calls.map((c) => c.action);

describe('governanceCallsFromSafeTx', () => {
  it('reads direct vault calls and skips allocations', () => {
    expect(governanceCallsFromSafeTx({ to: VAULT, data: submitMaxRate }, VAULT)).toEqual([
      { action: 'Submit setMaxRate', submittedData: setMaxRate.toLowerCase() },
    ]);
    expect(governanceCallsFromSafeTx({ to: VAULT, data: allocate }, VAULT)).toEqual([]);
  });

  it('unpacks vault multicall and MultiSend batches, ignoring other targets', () => {
    const multicall = encodeFunctionData({
      abi: vaultV2Abi,
      functionName: 'multicall',
      args: [[setMaxRate, allocate]],
    });
    expect(governanceCallsFromSafeTx({ to: VAULT, data: multicall }, VAULT)).toEqual([
      { action: 'setMaxRate', submittedData: null },
    ]);

    const batch = multiSend([
      { to: VAULT, data: submitMaxRate },
      { to: OTHER, data: setMaxRate },
    ]);
    expect(
      actions(governanceCallsFromSafeTx({ to: MULTI_SEND_CALL_ONLY, data: batch }, VAULT.toLowerCase()))
    ).toEqual(['Submit setMaxRate']);
  });

  it('ignores Safe txs to other contracts', () => {
    expect(governanceCallsFromSafeTx({ to: OTHER, data: setMaxRate }, VAULT)).toEqual([]);
  });
});

describe('signedAllocationAmount', () => {
  it('prefers the indexed change', () => {
    expect(signedAllocationAmount({ type: 'Allocate', assets: 575, change: 576 })).toBe('576');
    expect(signedAllocationAmount({ type: 'Deallocate', assets: 4, change: -4 })).toBe('-4');
  });
  it('signs assets by type when change is missing', () => {
    expect(signedAllocationAmount({ type: 'Deallocate', assets: '10', change: null })).toBe('-10');
    expect(signedAllocationAmount({ type: 'Allocate', assets: null, change: null })).toBeNull();
  });
});

describe('activityRoles', () => {
  const roles = {
    owner: '0xA',
    curator: '0xB',
    allocators: ['0xC', '0xD'],
    sentinels: ['0xc'],
    publicAllocator: '0xD',
  };
  it('lists every role an address holds, case-insensitively', () => {
    expect(activityRoles('0xc', roles)).toEqual(['Allocator', 'Sentinel']);
    expect(activityRoles('0xa', roles)).toEqual(['Owner']);
  });
  it('labels the Public Allocator on its own', () => {
    expect(activityRoles('0xd', roles)).toEqual(['Public Allocator']);
  });
  it('returns nothing for unknown or missing actors', () => {
    expect(activityRoles('0xE', roles)).toEqual([]);
    expect(activityRoles(null, roles)).toEqual([]);
  });
});

describe('sortActivity', () => {
  it('orders newest first', () => {
    const row = (id: string, timestamp: number) => ({ id, timestamp }) as VaultActivityRow;
    expect(sortActivity([row('a', 1), row('b', 3), row('c', 2)]).map((r) => r.id)).toEqual([
      'b',
      'c',
      'a',
    ]);
  });
  it('puts pending submissions without an executed row first', () => {
    const rows = [
      { id: 'old', timestamp: 1, actor: '0x1' },
      { id: 'pending', timestamp: 99, actor: null, pending: { validAt: 99 } },
      { id: 'new', timestamp: 50, actor: '0x1' },
    ] as VaultActivityRow[];
    expect(sortActivity(rows).map((r) => r.id)).toEqual(['pending', 'new', 'old']);
  });
});

describe('summarizeAdapter', () => {
  it('sums withdrawable liquidity and weights the rate by allocation', () => {
    const s = summarizeAdapter({
      allocationUsd: 300,
      markets: [
        { allocationUsd: 100, liquidityUsd: 50, supplyApy: 0.1 },
        { allocationUsd: 200, liquidityUsd: 1000, supplyApy: 0.04 },
        { allocationUsd: 0, liquidityUsd: 10, supplyApy: 0.5 },
      ],
    });
    expect(s.liquidityUsd).toBe(250);
    expect(s.rate).toBeCloseTo(0.06);
    expect(s.marketsCount).toBe(3);
    expect(s.activeMarketsCount).toBe(2);
  });
  it('uses the child vault for a fee-wrapper adapter', () => {
    const s = summarizeAdapter({
      allocationUsd: 100,
      markets: [],
      underlying: { liquidityUsd: 40, avgNetApy: null, netApy: 0.05 },
    });
    expect(s.liquidityUsd).toBe(40);
    expect(s.rate).toBe(0.05);
  });
});

describe('matchPendingConfig', () => {
  const setMaxRate2 = encodeFunctionData({ abi: vaultV2Abi, functionName: 'setMaxRate', args: [2n] });
  const TX = '0xAB';
  const pending = [
    { txHash: '0xab', data: setMaxRate, validAt: 100 },
    { txHash: '0xab', data: setMaxRate2, validAt: 300 },
  ];

  it('matches each submit in a batch to its own config', () => {
    const calls = governanceCallsFromSafeTx(
      {
        to: VAULT,
        data: encodeFunctionData({
          abi: vaultV2Abi,
          functionName: 'multicall',
          args: [
            [
              encodeFunctionData({ abi: vaultV2Abi, functionName: 'submit', args: [setMaxRate2] }),
              submitMaxRate,
              setMaxRate,
            ],
          ],
        }),
      },
      VAULT
    );
    const taken = new Set<number>();
    const matched = calls.map((c) => {
      const i = matchPendingConfig({ txHash: TX, submittedData: c.submittedData }, pending, taken);
      if (i >= 0) taken.add(i);
      return i >= 0 ? pending[i].validAt : null;
    });
    // submit(setMaxRate(2)) → 300, submit(setMaxRate(1)) → 100, direct setter → none.
    expect(matched).toEqual([300, 100, null]);
  });

  it('does not match another tx or a claimed config', () => {
    expect(
      matchPendingConfig({ txHash: '0xcd', submittedData: setMaxRate.toLowerCase() }, pending, new Set())
    ).toBe(-1);
    expect(
      matchPendingConfig({ txHash: TX, submittedData: setMaxRate.toLowerCase() }, pending, new Set([0]))
    ).toBe(-1);
  });
});

describe('pendingStatus', () => {
  it('never treats a missing unlock time as executable', () => {
    expect(pendingStatus(0, 1000)).toBe('unknown');
    expect(pendingStatus(null, 1000)).toBe('unknown');
    expect(pendingStatus(900, 1000)).toBe('executable');
    expect(pendingStatus(1100, 1000)).toBe('timelocked');
  });
});
