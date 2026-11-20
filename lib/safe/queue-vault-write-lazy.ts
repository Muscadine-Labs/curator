/**
 * Lazy entry points for queueing Safe proposals from vault pages.
 *
 * `queue-vault-write` pulls in the Safe Protocol Kit, API Kit and ethers
 * (about 900 KB of client JS). Vault components only call these functions
 * when someone queues a Safe proposal, so they import this module instead and
 * the heavy code loads on first use, not with every vault page.
 *
 * Signatures match `queue-vault-write` exactly.
 */
import type {
  queueSafeTransaction as QueueSafeTransaction,
  queueVaultRebalanceInSafe as QueueVaultRebalanceInSafe,
} from '@/lib/safe/queue-vault-write';

export async function queueSafeTransaction(
  ...args: Parameters<typeof QueueSafeTransaction>
): ReturnType<typeof QueueSafeTransaction> {
  const mod = await import('@/lib/safe/queue-vault-write');
  return mod.queueSafeTransaction(...args);
}

export async function queueVaultRebalanceInSafe(
  ...args: Parameters<typeof QueueVaultRebalanceInSafe>
): ReturnType<typeof QueueVaultRebalanceInSafe> {
  const mod = await import('@/lib/safe/queue-vault-write');
  return mod.queueVaultRebalanceInSafe(...args);
}
