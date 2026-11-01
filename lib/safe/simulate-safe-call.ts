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
 * eth_call the inner Safe transaction from the Safe's own address before it is
 * queued. Owners otherwise sign a proposal that can only fail at execution —
 * on the Sentinel path that is an emergency action discovered to be dead
 * after the signatures are collected.
 *
 * Only a revert blocks queueing. An RPC failure is not proof the call is bad,
 * and blocking an emergency proposal on a flaky RPC is worse than queueing it.
 */
export async function assertSafeCallSucceeds(input: {
  safe: Address;
  to: Address;
  data: Hex;
  value?: bigint;
}): Promise<void> {
  try {
    await client.call({ account: input.safe, to: input.to, data: input.data, value: input.value });
  } catch (error) {
    if (isRevertError(error)) {
      throw new Error(
        `This call reverts when the Safe executes it, so it was not queued: ${revertMessage(error)}`
      );
    }
  }
}
