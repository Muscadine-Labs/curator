import { keccak256, toHex, type Address, type Hex, type Log } from 'viem';

/** Same signature in every Safe ≥1.3; only where `txHash` sits differs (see below). */
const EXECUTION_SUCCESS_TOPIC = keccak256(toHex('ExecutionSuccess(bytes32,uint256)'));
const EXECUTION_FAILURE_TOPIC = keccak256(toHex('ExecutionFailure(bytes32,uint256)'));

export type SafeExecutionOutcome = 'success' | 'failure' | 'unknown';

/**
 * `txHash` of an ExecutionSuccess / ExecutionFailure log. Safe 1.3.0 leaves it unindexed (first
 * 32 bytes of `data`); 1.4.1 and later index it (`topics[1]`). An ABI with one layout silently
 * misses the other, so both are read here.
 */
function executionTxHash(log: Log): string | null {
  const indexed = log.topics[1];
  if (indexed) return indexed.toLowerCase();
  const data = log.data ?? '0x';
  return data.length >= 66 ? `0x${data.slice(2, 66)}`.toLowerCase() : null;
}

/**
 * Whether the Safe's inner call succeeded. A successful `execTransaction`
 * receipt is not enough: with `safeTxGas` or `gasPrice` non-zero the Safe
 * catches an inner revert, emits `ExecutionFailure`, and still uses the nonce.
 * `unknown` when neither event for this `safeTxHash` is in the logs.
 */
export function safeExecutionOutcome(
  logs: ReadonlyArray<Log>,
  safeAddress: Address,
  safeTxHash: Hex
): SafeExecutionOutcome {
  const safe = safeAddress.toLowerCase();
  const hash = safeTxHash.toLowerCase();
  for (const log of logs) {
    if (log.address?.toLowerCase() !== safe) continue;
    const topic = log.topics[0]?.toLowerCase();
    if (topic !== EXECUTION_SUCCESS_TOPIC && topic !== EXECUTION_FAILURE_TOPIC) continue;
    if (executionTxHash(log) !== hash) continue;
    return topic === EXECUTION_SUCCESS_TOPIC ? 'success' : 'failure';
  }
  return 'unknown';
}
