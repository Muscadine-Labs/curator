/**
 * Helpers for CCTP V2 attestation:
 *
 * V2 flow:
 *  - call `/v2/messages/{sourceDomainId}?transactionHash={hash}`
 *  - response contains message + attestation + decoded data in one call
 *  - no need to extract from receipt or hash manually
 */

import {
  type Address,
  type Hex,
  pad,
} from 'viem';
import { CIRCLE_API_V2_BASE } from './constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert a 20-byte EVM address to the bytes32 `mintRecipient` expected by depositForBurn
 * (left-padded with 12 zero bytes).
 */
export function addressToBytes32(address: Address): Hex {
  return pad(address, { size: 32 });
}

// ---------------------------------------------------------------------------
// V2 attestation
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
