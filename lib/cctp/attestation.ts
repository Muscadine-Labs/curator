/**
 * Helpers for CCTP attestation (V1 + V2):
 *
 * V1 flow:
 *  - extract the `message` bytes emitted by MessageTransmitter on the source tx
 *  - hash it (keccak256) to get the lookup key for Circle's attestation API
 *  - poll Circle until the attestation is ready
 *
 * V2 flow (simpler):
 *  - call `/v2/messages/{sourceDomainId}?transactionHash={hash}`
 *  - response contains message + attestation + decoded data in one call
 *  - no need to extract from receipt or hash manually
 */

import {
  type Address,
  type Hex,
  type TransactionReceipt,
  decodeEventLog,
  keccak256,
  pad,
} from 'viem';
import {
  CIRCLE_ATTESTATION_API,
  CIRCLE_API_V2_BASE,
  MESSAGE_TRANSMITTER_ABI,
} from './constants';

// ---------------------------------------------------------------------------
// Common types
// ---------------------------------------------------------------------------

export interface CctpAttestationResult {
  status: 'pending_confirmations' | 'complete' | 'failed';
  attestation?: Hex;
}

export interface CctpV2AttestationResult {
  status: 'pending_confirmations' | 'complete' | 'failed';
  message?: Hex;
  attestation?: Hex;
  cctpVersion?: number;
}

export interface CctpFeeEstimate {
  /** Fee in USDC raw units (6 decimals). `0n` if fee endpoint is unavailable. */
  fee: bigint;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Convert a 20-byte EVM address to the bytes32 `mintRecipient` expected by depositForBurn
 * (left-padded with 12 zero bytes).
 */
export function addressToBytes32(address: Address): Hex {
  return pad(address, { size: 32 });
}

// ---------------------------------------------------------------------------
// V1 helpers
// ---------------------------------------------------------------------------

/**
 * Extract the CCTP `MessageSent(bytes message)` log from a depositForBurn receipt.
 * Returns both the raw message bytes and its keccak256 (used as Circle's V1 attestation key).
 */
export function extractMessageFromReceipt(
  receipt: TransactionReceipt,
  messageTransmitter: Address
): { message: Hex; messageHash: Hex } | null {
  const lower = messageTransmitter.toLowerCase();
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== lower) continue;
    try {
      const decoded = decodeEventLog({
        abi: MESSAGE_TRANSMITTER_ABI,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName === 'MessageSent') {
        const message = decoded.args.message as Hex;
        return { message, messageHash: keccak256(message) };
      }
    } catch {
      // Not the MessageSent log — ignore and continue.
    }
  }
  return null;
}

/**
 * V1: Fetch attestation from Circle for a given message hash.
 * Circle returns 404 while pending — we normalize that to `pending_confirmations`.
 */
export async function fetchAttestation(
  messageHash: Hex,
  signal?: AbortSignal
): Promise<CctpAttestationResult> {
  const res = await fetch(`${CIRCLE_ATTESTATION_API}/${messageHash}`, {
    signal,
    cache: 'no-store',
  });
  if (res.status === 404) {
    return { status: 'pending_confirmations' };
  }
  if (!res.ok) {
    return { status: 'failed' };
  }
  const data = (await res.json()) as { status?: string; attestation?: string };
  if (data.status === 'complete' && data.attestation) {
    return {
      status: 'complete',
      attestation: data.attestation.startsWith('0x')
        ? (data.attestation as Hex)
        : (`0x${data.attestation}` as Hex),
    };
  }
  return { status: 'pending_confirmations' };
}

// ---------------------------------------------------------------------------
// V2 helpers
// ---------------------------------------------------------------------------

/**
 * V2: Fetch message + attestation in a single call using the transaction hash.
 * No need to extract from receipt or compute a message hash.
 *
 * Endpoint: `GET /v2/messages/{sourceDomainId}?transactionHash={hash}`
 */
export async function fetchAttestationV2(
  sourceDomainId: number,
  transactionHash: Hex,
  signal?: AbortSignal
): Promise<CctpV2AttestationResult> {
  const url = `${CIRCLE_API_V2_BASE}/v2/messages/${sourceDomainId}?transactionHash=${transactionHash}`;
  const res = await fetch(url, { signal, cache: 'no-store' });

  if (res.status === 404) {
    return { status: 'pending_confirmations' };
  }
  if (!res.ok) {
    return { status: 'failed' };
  }

  const data = (await res.json()) as {
    messages?: Array<{
      message?: string;
      attestation?: string;
      cctpVersion?: number;
      status?: string;
    }>;
  };

  const msg = data.messages?.[0];
  if (!msg) {
    return { status: 'pending_confirmations' };
  }

  if (msg.status === 'complete' && msg.message && msg.attestation) {
    const ensureHex = (s: string): Hex =>
      s.startsWith('0x') ? (s as Hex) : (`0x${s}` as Hex);
    return {
      status: 'complete',
      message: ensureHex(msg.message),
      attestation: ensureHex(msg.attestation),
      cctpVersion: msg.cctpVersion,
    };
  }

  return { status: 'pending_confirmations' };
}

/**
 * V2: Fetch the current fee for a transfer between two domains.
 * Endpoint: `GET /v2/burn/USDC/fees/{sourceDomainId}/{destDomainId}`
 *
 * Returns `{ fee: 0n }` if the endpoint is unavailable or returns an error
 * (fees are optional — Standard Transfer may be free on some routes).
 */
export async function fetchTransferFee(
  sourceDomainId: number,
  destDomainId: number,
  signal?: AbortSignal
): Promise<CctpFeeEstimate> {
  try {
    const url = `${CIRCLE_API_V2_BASE}/v2/burn/USDC/fees/${sourceDomainId}/${destDomainId}`;
    const res = await fetch(url, { signal, cache: 'no-store' });
    if (!res.ok) return { fee: 0n };

    const data = (await res.json()) as {
      fee?: string;
      fastFee?: string;
      standardFee?: string;
    };
    const feeStr = data.fee ?? data.fastFee ?? data.standardFee ?? '0';
    return { fee: BigInt(feeStr) };
  } catch {
    return { fee: 0n };
  }
}
