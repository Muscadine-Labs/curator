/**
 * Helpers for CCTP attestation:
 *  - extract the `message` bytes emitted by MessageTransmitter on the source tx
 *  - hash it (keccak256) to get the lookup key for Circle's attestation API
 *  - poll Circle until the attestation is ready
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
  MESSAGE_TRANSMITTER_ABI,
} from './constants';

export interface CctpAttestationResult {
  status: 'pending_confirmations' | 'complete' | 'failed';
  attestation?: Hex;
}

/**
 * Extract the CCTP `MessageSent(bytes message)` log from a depositForBurn receipt.
 * Returns both the raw message bytes and its keccak256 (used as Circle's attestation key).
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
 * Convert a 20-byte EVM address to the bytes32 `mintRecipient` expected by depositForBurn
 * (left-padded with 12 zero bytes).
 */
export function addressToBytes32(address: Address): Hex {
  return pad(address, { size: 32 });
}

/**
 * Fetch attestation from Circle for a given message hash.
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
