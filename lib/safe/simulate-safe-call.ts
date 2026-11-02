'use client';

import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  ExecutionRevertedError,
  http,
  RawContractError,
  type Address,
  type Hex,
} from 'viem';
import { base } from '@/lib/onchain/base-chain';
import { BASE_CHAIN_ID } from '@/lib/constants';
import { getWalletRpcUrl } from '@/lib/wallet/rpc';

const client = createPublicClient({
  chain: base,
  transport: http(getWalletRpcUrl(BASE_CHAIN_ID)),
});

/** True when the error is the call reverting, not the RPC failing. */
export function isRevertError(error: unknown): boolean {
  return (
    error instanceof BaseError &&
    error.walk(
      (e) =>
        e instanceof ExecutionRevertedError ||
        e instanceof RawContractError ||
        e instanceof ContractFunctionRevertedError
    ) != null
  );
}

function revertMessage(error: unknown): string {
  if (error instanceof BaseError) return error.shortMessage;
  return error instanceof Error ? error.message : String(error);
}

/**
 * What a revert means for queueing. With nothing queued ahead, the call is
 * dead and must not be signed. With earlier proposals still queued, the
 * simulation ran against today's state, not the state after those execute
 * (nonce N funds the Safe, N+1 spends it), so it is a warning, not a block.
 */
export function safeCallRevertOutcome(
  revertReason: string,
  queuedAhead: number
): { block: true; message: string } | { block: false; warning: string } {
  if (queuedAhead <= 0) {
    return {
      block: true,
      message: `This call reverts when the Safe executes it, so it was not queued: ${revertReason}`,
    };
  }
  const n = `${queuedAhead} earlier queued proposal${queuedAhead === 1 ? '' : 's'}`;
  return {
    block: false,
    warning: `Reverts against the current chain state (${revertReason}). It may depend on ${n}; execute ${queuedAhead === 1 ? 'it' : 'them'} first and check this call again before signing.`,
  };
}

/**
 * Distinct unexecuted proposals for one Safe: local rows plus Transaction
 * Service rows (another browser's proposal exists only there until a manual
 * sync), counted once per `safeTxHash`. Service rows below the on-chain nonce
 * were replaced or executed and do not count.
 */
export function countDistinctQueuedProposals(
  localHashes: ReadonlyArray<string>,
  serviceTxs: ReadonlyArray<{ safeTxHash: string; nonce: string | number }>,
  onChainNonce: number | null
): number {
  const hashes = new Set(localHashes.map((h) => h.toLowerCase()));
  for (const tx of serviceTxs) {
    const nonce = Number(tx.nonce);
    if (onChainNonce != null && Number.isFinite(nonce) && nonce < onChainNonce) continue;
    hashes.add(tx.safeTxHash.toLowerCase());
  }
  return hashes.size;
}

/**
 * eth_call the inner Safe transaction from the Safe's own address before it is
 * queued. Owners otherwise sign a proposal that can only fail at execution —
 * on the Sentinel path that is an emergency action discovered to be dead
 * after the signatures are collected.
 *
 * Only a revert matters. An RPC failure is not proof the call is bad, and
 * blocking an emergency proposal on a flaky RPC is worse than queueing it.
 * Returns a warning for the queue card when the revert may come from
 * proposals queued ahead of this one (`safeCallRevertOutcome`).
 */
export async function checkSafeCallBeforeQueue(input: {
  safe: Address;
  to: Address;
  data: Hex;
  value?: bigint;
  /**
   * Unexecuted proposals already queued for this Safe. Called only when the
   * call reverts, so the Transaction Service is not hit on the happy path.
   */
  countQueuedAhead: () => Promise<number>;
}): Promise<string | null> {
  try {
    await client.call({ account: input.safe, to: input.to, data: input.data, value: input.value });
    return null;
  } catch (error) {
    if (!isRevertError(error)) return null;
    const outcome = safeCallRevertOutcome(revertMessage(error), await input.countQueuedAhead());
    if (outcome.block) throw new Error(outcome.message);
    return outcome.warning;
  }
}
