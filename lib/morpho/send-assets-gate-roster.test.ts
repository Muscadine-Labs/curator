import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeAbiParameters, encodeEventTopics, parseAbiItem } from 'viem';
import {
  accountsFromGateLog,
  readGateRosterCandidates,
} from '@/lib/morpho/send-assets-gate-roster.server';

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
});
