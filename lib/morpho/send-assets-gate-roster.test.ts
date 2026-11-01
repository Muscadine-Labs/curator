import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  concat,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  encodePacked,
  parseAbi,
  parseAbiItem,
  size,
} from 'viem';
import type { GateHistoryCheckpoint } from '@/lib/morpho/send-assets-gate-history';
import {
  accountsFromGateLog,
  accountsFromSafeTx,
  readGateRosterCandidates,
  scanGateLogs,
} from '@/lib/morpho/send-assets-gate-roster.server';
import { whitelistSendAssetsGateAbi } from '@/lib/onchain/whitelist-send-assets-gate-abi';
import { publicClient } from '@/lib/onchain/client';

vi.mock('@/lib/onchain/client', () => ({
  publicClient: {
    getLogs: vi.fn(async () => {
      throw new Error('block range too large https://rpc.example/secret-key');
    }),
  },
}));

const WHITELISTER = '0x2Ed45BB3542d06d81D117acd8A561e910A17A618';
const ACCOUNT = '0xD437c78a6bA1F42Dca908F3759ab8B8A42Af4D82';

describe('accountsFromGateLog', () => {
  it('reads both indexed addresses from a SetIsWhitelisted log', () => {
    const event = parseAbiItem(
      'event SetIsWhitelisted(address indexed whitelister, address indexed account, bool newIsWhitelisted)'
    );
    const topics = encodeEventTopics({
      abi: [event],
      eventName: 'SetIsWhitelisted',
      args: { whitelister: WHITELISTER, account: ACCOUNT },
    }).flatMap((topic) => (Array.isArray(topic) ? topic : [topic]));
    const data = encodeAbiParameters([{ type: 'bool' }], [true]);
    expect(
      accountsFromGateLog({ data, topics: [...topics, null, null] })
        .map((address) => address.toLowerCase())
        .sort()
    ).toEqual([ACCOUNT.toLowerCase(), WHITELISTER.toLowerCase()].sort());
  });

  it('ignores logs that are not roster events', () => {
    expect(
      accountsFromGateLog({ data: '0x', topics: [`0x${'ab'.repeat(32)}`] })
    ).toEqual([]);
  });
});

function whitelistedLog(account: `0x${string}`, blockNumber: number) {
  const event = parseAbiItem(
    'event SetIsWhitelisted(address indexed whitelister, address indexed account, bool newIsWhitelisted)'
  );
  const topics = encodeEventTopics({
    abi: [event],
    eventName: 'SetIsWhitelisted',
    args: { whitelister: WHITELISTER, account },
  }).flatMap((topic) => (Array.isArray(topic) ? topic : [topic]));
  return {
    blockNumber: `0x${blockNumber.toString(16)}`,
    data: encodeAbiParameters([{ type: 'bool' }], [true]),
    topics,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

describe('readGateRosterCandidates', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('explains a Cloudflare challenge instead of failing silently', async () => {
    vi.stubEnv('BLOCKSCOUT_API_KEY', '');
    vi.stubEnv('ETHERSCAN_API_KEY', '');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<!DOCTYPE html><title>Just a moment...</title>', { status: 403 }))
    );
    const result = await readGateRosterCandidates('0x0000000000000000000000000000000000000001');
    expect(result.status).toBe('failed');
    expect(result.reason).toContain('bot challenge (HTTP 403)');
    expect(result.reason).toContain('NEXT_PUBLIC_SAFE_API_KEY');
    expect(result.reason).not.toContain('secret-key');
  });

  it('uses the keyed Blockscout API and re-reads the block a full page ended in', async () => {
    vi.stubEnv('BLOCKSCOUT_API_KEY', 'test-key');
    const other = '0x1111111111111111111111111111111111111111' as const;
    const firstPage = Array.from({ length: 1_000 }, () => whitelistedLog(ACCOUNT, 7));
    const fromBlocks: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: URL) => {
        expect(input.host).toBe('api.blockscout.com');
        expect(input.searchParams.get('apikey')).toBe('test-key');
        const fromBlock = input.searchParams.get('fromBlock') ?? '';
        fromBlocks.push(fromBlock);
        if (fromBlock === '0') return jsonResponse({ status: '1', result: firstPage });
        return jsonResponse({ status: '1', result: [whitelistedLog(other, 7)] });
      })
    );
    const result = await readGateRosterCandidates('0x0000000000000000000000000000000000000002');
    expect(result.status).toBe('complete');
    expect(fromBlocks).toEqual(['0', '7']);
    expect(result.accounts.map((a) => a.toLowerCase()).sort()).toEqual(
      [ACCOUNT, WHITELISTER, other].map((a) => a.toLowerCase()).sort()
    );
  });

  it('reads whitelist calls from the Curator and Allocator Safe histories', async () => {
    vi.stubEnv('NEXT_PUBLIC_SAFE_API_KEY', 'safe-key');
    vi.stubEnv('BLOCKSCOUT_API_KEY', '');
    vi.stubEnv('ETHERSCAN_API_KEY', '');
    const gate = '0x0000000000000000000000000000000000000005';
    const removed = '0x2222222222222222222222222222222222222222' as const;
    const allow = encodeFunctionData({
      abi: whitelistSendAssetsGateAbi,
      functionName: 'setIsWhitelisted',
      args: [ACCOUNT, true],
    });
    const deny = encodeFunctionData({
      abi: whitelistSendAssetsGateAbi,
      functionName: 'setIsWhitelisted',
      args: [removed, false],
    });
    const bundled = encodeFunctionData({
      abi: whitelistSendAssetsGateAbi,
      functionName: 'multicall',
      args: [[allow]],
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: URL) => {
        expect(input.host).toBe('api.safe.global');
        expect(input.searchParams.get('executed')).toBe('true');
        const safe = input.pathname.toLowerCase();
        if (safe.includes('0x2ed45bb3542d06d81d117acd8a561e910a17a618')) {
          return jsonResponse({
            next: null,
            results: [
              { to: gate, isExecuted: true, isSuccessful: true, data: deny },
              {
                to: '0x314fD07319ef645bA7D548915CCd91F4788A1839',
                isExecuted: true,
                isSuccessful: true,
                data: bundled,
              },
            ],
          });
        }
        return jsonResponse({
          next: null,
          results: [{ to: gate, isExecuted: true, isSuccessful: true, data: bundled }],
        });
      })
    );
    const result = await scanGateLogs(gate);
    expect(result.status).toBe('complete');
    expect(result.accounts.map((address) => address.toLowerCase()).sort()).toEqual(
      [ACCOUNT, removed].map((address) => address.toLowerCase()).sort()
    );
  });

  it('stops at the checkpoint hashes and keeps the accounts already read', async () => {
    vi.stubEnv('NEXT_PUBLIC_SAFE_API_KEY', 'safe-key');
    vi.stubEnv('BLOCKSCOUT_API_KEY', '');
    vi.stubEnv('ETHERSCAN_API_KEY', '');
    const gate = '0x0000000000000000000000000000000000000006' as const;
    const known = '0x4444444444444444444444444444444444444444' as const;
    const fresh = '0x5555555555555555555555555555555555555555' as const;
    const stopHash = `0x${'ab'.repeat(32)}` as const;
    const checkpoint: GateHistoryCheckpoint = {
      gate,
      recordedAt: '2026-10-31T23:34:51Z',
      accounts: [known],
      safes: [
        {
          address: '0xb6d1d784e9Bc3570546e231caCB52B4E0f1ED8b1',
          nonce: 224,
          executionDate: '2026-10-31T21:40:07Z',
          safeTxHash: stopHash,
          transactionHash: stopHash,
        },
        {
          address: WHITELISTER,
          nonce: 148,
          executionDate: '2026-10-31T23:34:51Z',
          safeTxHash: stopHash,
          transactionHash: stopHash,
        },
      ],
    };
    const allow = encodeFunctionData({
      abi: whitelistSendAssetsGateAbi,
      functionName: 'setIsWhitelisted',
      args: [fresh, true],
    });
    const fetched: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: URL) => {
        fetched.push(input.pathname);
        expect(input.pathname).not.toContain('older-page');
        return jsonResponse({
          next: 'https://api.safe.global/tx-service/base/api/v2/older-page',
          results: [
            {
              to: gate,
              isExecuted: true,
              isSuccessful: true,
              executionDate: '2026-10-31T23:40:00Z',
              data: allow,
            },
            {
              safeTxHash: stopHash,
              transactionHash: stopHash,
              executionDate: '2026-10-31T23:34:51Z',
            },
          ],
        });
      })
    );
    const result = await scanGateLogs(gate, undefined, checkpoint);
    expect(fetched).toHaveLength(2);
    expect(result.status).toBe('complete');
    expect(result.accounts.map((address) => address.toLowerCase()).sort()).toEqual(
      [known, fresh].map((address) => address.toLowerCase()).sort()
    );
  });

  it('keeps time for the RPC fallback when every explorer stalls', async () => {
    vi.stubEnv('BLOCKSCOUT_API_KEY', 'test-key');
    vi.stubEnv('ETHERSCAN_API_KEY', 'test-key');
    // Explorers never answer; they only stop when their abort signal fires.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_input: URL, init?: RequestInit) =>
          new Promise<Response>((_, reject) => {
            init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
          })
      )
    );
    const log = whitelistedLog(ACCOUNT, 9);
    vi.mocked(publicClient.getLogs).mockResolvedValueOnce([
      { ...log, blockNumber: 9n },
    ] as unknown as Awaited<ReturnType<typeof publicClient.getLogs>>);

    const started = Date.now();
    const result = await scanGateLogs('0x0000000000000000000000000000000000000003', {
      totalMs: 600,
      rpcReserveMs: 300,
    });
    expect(Date.now() - started).toBeLessThan(600);
    expect(result.status).toBe('complete');
    expect(result.accounts.map((a) => a.toLowerCase()).sort()).toEqual(
      [ACCOUNT, WHITELISTER].map((a) => a.toLowerCase()).sort()
    );
  });

  it('gives up on a stalled RPC at the overall deadline', async () => {
    vi.stubEnv('BLOCKSCOUT_API_KEY', '');
    vi.stubEnv('ETHERSCAN_API_KEY', '');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>Just a moment...</html>', { status: 403 }))
    );
    vi.mocked(publicClient.getLogs).mockImplementationOnce(() => new Promise(() => {}));
    const started = Date.now();
    const result = await scanGateLogs('0x0000000000000000000000000000000000000004', {
      totalMs: 300,
      rpcReserveMs: 100,
    });
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(result.status).toBe('failed');
    expect(result.reason).toContain('Base RPC: timed out');
  });
});

describe('accountsFromSafeTx', () => {
  const gate = '0x0000000000000000000000000000000000000007' as const;
  const viaBatch = '0x6666666666666666666666666666666666666666' as const;
  const delegated = '0x7777777777777777777777777777777777777777' as const;
  const multiSendCallOnly = '0x40A2aCCbd92BCA938b02010E17A5b8929b49130D' as const;
  const pack = (operation: 0 | 1, to: `0x${string}`, data: `0x${string}`) =>
    encodePacked(
      ['uint8', 'address', 'uint256', 'uint256', 'bytes'],
      [operation, to, 0n, BigInt(size(data)), data]
    );

  it('reads gate calls bundled in a MultiSend batch', () => {
    const allow = encodeFunctionData({
      abi: whitelistSendAssetsGateAbi,
      functionName: 'setIsWhitelisted',
      args: [viaBatch, true],
    });
    const viaDelegate = encodeFunctionData({
      abi: whitelistSendAssetsGateAbi,
      functionName: 'setIsWhitelisted',
      args: [delegated, true],
    });
    const other = encodeFunctionData({
      abi: whitelistSendAssetsGateAbi,
      functionName: 'setIsWhitelisted',
      args: [delegated, true],
    });
    const batch = encodeFunctionData({
      abi: parseAbi(['function multiSend(bytes transactions)']),
      args: [
        concat([
          pack(0, gate, allow),
          pack(1, gate, viaDelegate),
          pack(0, '0x314fD07319ef645bA7D548915CCd91F4788A1839', other),
        ]),
      ],
    });
    expect(accountsFromSafeTx({ to: multiSendCallOnly, data: batch }, gate)).toEqual([viaBatch]);
  });

  it('ignores a batch sent to a contract that is not a known MultiSend', () => {
    const batch = encodeFunctionData({
      abi: parseAbi(['function multiSend(bytes transactions)']),
      args: [
        pack(
          0,
          gate,
          encodeFunctionData({
            abi: whitelistSendAssetsGateAbi,
            functionName: 'setIsWhitelisted',
            args: [viaBatch, true],
          })
        ),
      ],
    });
    expect(
      accountsFromSafeTx({ to: '0x8888888888888888888888888888888888888888', data: batch }, gate)
    ).toEqual([]);
  });
});
