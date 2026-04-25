/**
 * @jest-environment node
 *
 * Tests for `lib/cctp/attestation.ts` — V2 attestation, fee fetching, and address padding.
 */

import {
  type Address,
  type Hex,
  pad,
} from 'viem';
import {
  addressToBytes32,
  fetchAttestationV2,
  fetchTransferFee,
} from '../attestation';

const RECIPIENT: Address = '0x000000000000000000000000000000000000beef';

describe('addressToBytes32', () => {
  test('left-pads a 20-byte address to 32 bytes with zeros', () => {
    const out = addressToBytes32(RECIPIENT);
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

describe('fetchAttestationV2', () => {
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

  test('calls /v2/messages/{domain} with transactionHash', async () => {
    const txHash = ('0x' + 'ab'.repeat(32)) as Hex;
    mockFetch((url) => {
      expect(url).toContain('/v2/messages/0');
      expect(url).toContain(`transactionHash=${txHash}`);
      return new Response(JSON.stringify({ messages: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const out = await fetchAttestationV2(0, txHash);
    expect(out.status).toBe('pending_confirmations');
  });

  test('returns complete with message and attestation', async () => {
    mockFetch(() =>
      new Response(
        JSON.stringify({
          messages: [
            {
              message: '0xdeadbeef',
              attestation: '0xcafebabe',
              cctpVersion: 2,
              status: 'complete',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    const out = await fetchAttestationV2(6, ('0x' + 'ab'.repeat(32)) as Hex);
    expect(out.status).toBe('complete');
    expect(out.message).toBe('0xdeadbeef');
    expect(out.attestation).toBe('0xcafebabe');
    expect(out.cctpVersion).toBe(2);
  });

  test('treats 404 as pending', async () => {
    mockFetch(() => new Response(null, { status: 404 }));
    const out = await fetchAttestationV2(0, ('0x' + 'ab'.repeat(32)) as Hex);
    expect(out.status).toBe('pending_confirmations');
  });

  test('returns failed on 500', async () => {
    mockFetch(() => new Response('error', { status: 500 }));
    const out = await fetchAttestationV2(0, ('0x' + 'ab'.repeat(32)) as Hex);
    expect(out.status).toBe('failed');
  });

  test('prefixes 0x when attestation lacks it', async () => {
    mockFetch(() =>
      new Response(
        JSON.stringify({
          messages: [
            {
              message: 'aabb',
              attestation: 'ccdd',
              status: 'complete',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    const out = await fetchAttestationV2(6, ('0x' + 'ab'.repeat(32)) as Hex);
    expect(out.message).toBe('0xaabb');
    expect(out.attestation).toBe('0xccdd');
  });
});

describe('fetchTransferFee', () => {
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

  test('returns fee from API response', async () => {
    mockFetch(() =>
      new Response(JSON.stringify({ fee: '100000' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    const out = await fetchTransferFee(0, 6);
    expect(out.fee).toBe(100000n);
  });

  test('returns 0n on error', async () => {
    mockFetch(() => new Response('error', { status: 500 }));
    const out = await fetchTransferFee(0, 6);
    expect(out.fee).toBe(0n);
  });

  test('returns 0n on fetch failure', async () => {
    mockFetch(() => { throw new Error('network error'); });
    const out = await fetchTransferFee(0, 6);
    expect(out.fee).toBe(0n);
  });
});
