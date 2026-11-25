import { getAddress, type Address } from 'viem';
import { fetchVaultPendingSubmits } from '@/lib/morpho/vault-v2-pending.server';
import { withServerResponseCache } from '@/lib/api/server-response-cache';
import { API_CACHE_MAX_AGE_MS } from '@/lib/api/response-cache';
import {
  describeVaultCall,
  governanceCallsFromSafeTx,
  matchPendingConfig,
  sortActivity,
  type VaultActivityRow,
} from '@/lib/morpho/vault-activity';
import { SAFE_ACCOUNTS } from '@/lib/safe/config';
import {
  fetchExecutedMultisigTransactions,
  isTransactionServiceConfigured,
  type ServiceHistoryTx,
} from '@/lib/safe/transaction-service';
import { logger } from '@/lib/utils/logger';


/** Safes whose executed history can hold vault governance calls. */
const GOVERNANCE_SAFE_ROLES = new Set(['owner', 'curator', 'sentinel', 'allocator']);

export type VaultActivityResponse = {
  rows: VaultActivityRow[];
  /**
   * Executed governance comes from the Muscadine role Safes' Transaction
   * Service history (Morpho does not index it). `unavailable` = no Safe API
   * key, `partial` = some Safe histories failed to load.
   */
  governanceHistory: 'complete' | 'partial' | 'unavailable';
  /**
   * Unix seconds. A Safe history hit the page limit, so governance executed
   * before this time may be missing. Null when every history was read whole.
   */
  governanceHistorySince: number | null;
  /** Pending submissions: `unavailable` when the REST / receipt / on-chain read failed. */
  pendingHistory: 'complete' | 'unavailable';
};

/** Newest executed txs read per Safe (shared across every vault the Safe governs). */
const SAFE_HISTORY_LIMIT = 100;

type SafeHistory = { txs: ServiceHistoryTx[]; truncated: boolean };

/**
 * One cached read per Safe, keyed by the Safe — not per vault — so opening
 * Activity on several vaults does not re-spend the 5 req/s Transaction
 * Service quota on identical histories.
 */
export function loadSafeHistory(safe: Address): Promise<SafeHistory> {
  return withServerResponseCache(
    `safe-executed-history:${safe.toLowerCase()}:${SAFE_HISTORY_LIMIT}`,
    API_CACHE_MAX_AGE_MS,
    async () => {
      const txs = await fetchExecutedMultisigTransactions(safe, { limit: SAFE_HISTORY_LIMIT });
      return { txs, truncated: txs.length >= SAFE_HISTORY_LIMIT };
    }
  );
}

function executionTime(tx: ServiceHistoryTx): number {
  return tx.executionDate ? Math.floor(Date.parse(tx.executionDate) / 1000) : 0;
}

type GovernanceRow = VaultActivityRow & { submittedData: string | null };

async function governanceRowsFromSafes(vault: Address): Promise<{
  rows: GovernanceRow[];
  status: VaultActivityResponse['governanceHistory'];
  since: number | null;
}> {
  if (!isTransactionServiceConfigured()) return { rows: [], status: 'unavailable', since: null };

  const safes = SAFE_ACCOUNTS.filter((s) => GOVERNANCE_SAFE_ROLES.has(s.role));
  let failed = 0;
  let since: number | null = null;
  const rows: GovernanceRow[] = [];
  // Sequential: the Transaction Service free tier is 5 req/s and the client
  // already serializes through withSafeTxServiceRateLimit.
  for (const safe of safes) {
    try {
      const history = await loadSafeHistory(safe.address);
      if (history.truncated && history.txs.length > 0) {
        const oldest = Math.min(...history.txs.map(executionTime).filter((t) => t > 0));
        if (Number.isFinite(oldest)) since = since == null ? oldest : Math.max(since, oldest);
      }
      for (const tx of history.txs) {
        if (tx.isSuccessful === false) continue;
        const ts = executionTime(tx);
        governanceCallsFromSafeTx({ to: tx.to, data: tx.data }, vault).forEach((call, i) => {
          rows.push({
            id: `gov-${tx.safeTxHash}-${i}`,
            timestamp: ts,
            action: call.action,
            actor: safe.address,
            txHash: tx.transactionHash ?? null,
            submittedData: call.submittedData,
          });
        });
      }
    } catch (error) {
      failed += 1;
      logger.warn('Vault activity: Safe history unavailable', {
        safe: safe.address,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { rows, status: failed === 0 ? 'complete' : 'partial', since };
}

export async function fetchVaultActivity(
  vaultAddress: string,
  chainId: number
): Promise<VaultActivityResponse> {
  const vault = getAddress(vaultAddress);
  return withServerResponseCache(
    `vault-activity:${chainId}:${vault.toLowerCase()}`,
    API_CACHE_MAX_AGE_MS,
    async () => {
      const [pendingSubmits, governance] = await Promise.all([
        fetchVaultPendingSubmits(vault, chainId).catch((error: unknown) => {
          logger.warn('Vault activity: pending submissions unavailable', {
            vault,
            error: error instanceof Error ? error.message : String(error),
          });
          return null;
        }),
        governanceRowsFromSafes(vault),
      ]);

      const pendingConfigs = (pendingSubmits ?? []).map((p) => ({
        txHash: p.txHash,
        data: p.data as string,
        functionName: p.functionName,
        validAt: p.validAt,
      }));

      // Reconcile executed Safe calls with pending configs call by call (tx
      // hash + submitted calldata): one batch can submit several configs with
      // different timelocks, alongside calls that have none.
      const matched = new Set<number>();
      const governanceRows: VaultActivityRow[] = governance.rows.map(({ submittedData, ...row }) => {
        const idx = matchPendingConfig({ txHash: row.txHash, submittedData }, pendingConfigs, matched);
        if (idx < 0) return row;
        matched.add(idx);
        return { ...row, pending: { validAt: pendingConfigs[idx].validAt } };
      });

      const pendingOnly: VaultActivityRow[] = pendingConfigs
        .filter((_, i) => !matched.has(i))
        .map((p, i) => ({
          id: `pending-${p.txHash ?? 'unknown'}-${i}`,
          timestamp: p.validAt,
          action: `Submit ${describeVaultCall(p.data) ?? p.functionName}`,
          actor: null,
          txHash: p.txHash,
          pending: { validAt: p.validAt },
        }));

      return {
        rows: sortActivity([...governanceRows, ...pendingOnly]),
        governanceHistory: governance.status,
        governanceHistorySince: governance.since,
        pendingHistory: pendingSubmits ? 'complete' : 'unavailable',
      };
    },
    // A partial result is served but not cached, so the next request retries.
    (result) =>
      result.governanceHistory !== 'partial' && result.pendingHistory !== 'unavailable'
  );
}
