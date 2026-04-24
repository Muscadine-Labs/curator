/**
 * @jest-environment node
 *
 * Tests for `lib/cctp/attestation.ts` — message extraction, address padding,
 * and Circle attestation polling.
 */

import {
  type Address,
  type Hex,
  type TransactionReceipt,
  encodeAbiParameters,
  keccak256,
  pad,
  toHex,
} from 'viem';
import {
  addressToBytes32,
  extractMessageFromReceipt,
  fetchAttestation,
} from '../attestation';

const TOKEN_MESSENGER: Address = '0x1682Ae6375C4E4A97e4B583BC394c861A46D8962'; // Base, EIP-55 checksummed
const MESSAGE_TRANSMITTER: Address = '0xAD09780d193884d503182aD4588450C416D6F9D4'; // Base, EIP-55 checksummed
const RECIPIENT: Address = '0x000000000000000000000000000000000000beef';

// keccak256("MessageSent(bytes)") — the topic emitted by MessageTransmitter.
const MESSAGE_SENT_TOPIC: Hex = keccak256(toHex('MessageSent(bytes)'));

function makeMessageSentLog(message: Hex, address: Address) {
  // The single non-indexed `bytes message` arg is ABI-encoded into `data`.
  const data = encodeAbiParameters([{ type: 'bytes' }], [message]);
  return {
    address,
    data,
    topics: [MESSAGE_SENT_TOPIC] as readonly Hex[],
    blockHash: ('0x' + '00'.repeat(32)) as Hex,
    blockNumber: 0n,
    logIndex: 0,
    removed: false,
    transactionHash: ('0x' + '11'.repeat(32)) as Hex,
    transactionIndex: 0,
  };
}

function makeReceipt(logs: ReturnType<typeof makeMessageSentLog>[]): TransactionReceipt {
  return {
    blockHash: ('0x' + '00'.repeat(32)) as Hex,
    blockNumber: 1n,
    contractAddress: null,
    cumulativeGasUsed: 0n,
    effectiveGasPrice: 0n,
    from: '0x0000000000000000000000000000000000000001',
    gasUsed: 0n,
    logs: logs as unknown as TransactionReceipt['logs'],
    logsBloom: ('0x' + '00'.repeat(256)) as Hex,
    status: 'success',
    to: TOKEN_MESSENGER,
    transactionHash: ('0x' + '11'.repeat(32)) as Hex,
    transactionIndex: 0,
    type: 'eip1559',
  };
}

describe('addressToBytes32', () => {
  test('left-pads a 20-byte address to 32 bytes with zeros', () => {
    const out = addressToBytes32(RECIPIENT);
    // viem may preserve checksum case in the output; do all comparisons on
    // the lowercased hex string.
    const lower = out.toLowerCase();
    expect(lower).toMatch(/^0x[0-9a-f]{64}$/);
    expect(lower.slice(2, 26)).toBe('0'.repeat(24));
    expect(lower.slice(26)).toBe(RECIPIENT.toLowerCase().slice(2));
  });

  test('matches viem.pad(address, { size: 32 })', () => {
    expect(addressToBytes32(RECIPIENT).toLowerCase()).toBe(
      pad(RECIPIENT, { size: 32 }).toLowerCase()
    );
  });
});

describe('extractMessageFromReceipt', () => {
  test('returns the MessageSent payload + its keccak256 hash', () => {
    const message: Hex = ('0x' + 'ab'.repeat(64)) as Hex; // 64 bytes of dummy CCTP message
    const log = makeMessageSentLog(message, MESSAGE_TRANSMITTER);
    const receipt = makeReceipt([log]);
    const out = extractMessageFromReceipt(receipt, MESSAGE_TRANSMITTER);
    expect(out).not.toBeNull();
    expect(out!.message).toBe(message);
    expect(out!.messageHash).toBe(keccak256(message));
  });

  test('ignores logs from other addresses', () => {
    const message: Hex = ('0x' + 'ab'.repeat(64)) as Hex;
    const log = makeMessageSentLog(message, TOKEN_MESSENGER); // wrong address
    const receipt = makeReceipt([log]);
    expect(extractMessageFromReceipt(receipt, MESSAGE_TRANSMITTER)).toBeNull();
  });

  test('matches MessageTransmitter address case-insensitively', () => {
    const message: Hex = ('0x' + 'cd'.repeat(48)) as Hex;
    const log = makeMessageSentLog(message, MESSAGE_TRANSMITTER);
    const receipt = makeReceipt([log]);
    const out = extractMessageFromReceipt(
      receipt,
      MESSAGE_TRANSMITTER.toUpperCase() as Address
    );
    expect(out).not.toBeNull();
    expect(out!.message).toBe(message);
  });

  test('returns null when no MessageSent log is present', () => {
    const receipt = makeReceipt([]);
    expect(extractMessageFromReceipt(receipt, MESSAGE_TRANSMITTER)).toBeNull();
  });
});

describe('fetchAttestation', () => {
  const ORIGINAL_FETCH = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
  });

  function mockFetch(impl: (url: string) => Response | Promise<Response>) {
    globalThis.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      return impl(url);
    }) as unknown as typeof fetch;
  }

  test('treats 404 as pending_confirmations', async () => {
    mockFetch(() => new Response(null, { status: 404 }));
    const out = await fetchAttestation(('0x' + 'aa'.repeat(32)) as Hex);
    expect(out).toEqual({ status: 'pending_confirmations' });
  });

  test('returns failed on non-OK non-404', async () => {
    mockFetch(() => new Response('boom', { status: 500 }));
    const out = await fetchAttestation(('0x' + 'aa'.repeat(32)) as Hex);
    expect(out).toEqual({ status: 'failed' });
  });

  test('returns complete + 0x-prefixed attestation when Circle is ready', async () => {
    mockFetch(() =>
      new Response(
        JSON.stringify({ status: 'complete', attestation: '0xdeadbeef' }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    const out = await fetchAttestation(('0x' + 'bb'.repeat(32)) as Hex);
    expect(out.status).toBe('complete');
    expect(out.attestation).toBe('0xdeadbeef');
  });

  test('prefixes 0x when Circle returns the attestation without it', async () => {
    mockFetch(() =>
      new Response(
        JSON.stringify({ status: 'complete', attestation: 'cafebabe' }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    const out = await fetchAttestation(('0x' + 'bb'.repeat(32)) as Hex);
    expect(out.attestation).toBe('0xcafebabe');
  });

  test('falls back to pending when status is non-complete', async () => {
    mockFetch(() =>
      new Response(JSON.stringify({ status: 'pending_confirmations' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    const out = await fetchAttestation(('0x' + 'cc'.repeat(32)) as Hex);
    expect(out).toEqual({ status: 'pending_confirmations' });
  });
});
