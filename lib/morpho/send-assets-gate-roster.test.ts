import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeAbiParameters, encodeEventTopics, parseAbiItem } from 'viem';
import {
  accountsFromGateLog,
  readGateRosterCandidates,
  scanGateLogs,
} from '@/lib/morpho/send-assets-gate-roster.server';
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
    expect(result.reason).toContain('BLOCKSCOUT_API_KEY');
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
