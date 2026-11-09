import { parseAbi, parseEventLogs, type Address, type Hex, type Log } from 'viem';

/** Safe ≥1.3 emits one of these from the Safe for every execTransaction. */
const SAFE_EXECUTION_EVENTS_ABI = parseAbi([
  'event ExecutionSuccess(bytes32 txHash, uint256 payment)',
  'event ExecutionFailure(bytes32 txHash, uint256 payment)',
]);

export type SafeExecutionOutcome = 'success' | 'failure' | 'unknown';

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
  const events = parseEventLogs({
    abi: SAFE_EXECUTION_EVENTS_ABI,
    logs: logs as Log[],
    strict: false,
  });
  for (const event of events) {
    if (event.address.toLowerCase() !== safe) continue;
    if (event.args.txHash?.toLowerCase() !== hash) continue;
    return event.eventName === 'ExecutionSuccess' ? 'success' : 'failure';
  }
  return 'unknown';
}
