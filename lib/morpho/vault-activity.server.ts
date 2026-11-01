import { gql } from 'graphql-request';
import { getAddress, type Address } from 'viem';
import { morphoGraphQLClient } from '@/lib/morpho/graphql-client';
import { withServerResponseCache } from '@/lib/api/server-response-cache';
import { API_CACHE_MAX_AGE_MS } from '@/lib/api/response-cache';
import {
  describeVaultCall,
  governanceCallsFromSafeTx,
  signedAllocationAmount,
  sortActivity,
  type VaultActivityRow,
} from '@/lib/morpho/vault-activity';
import { SAFE_ACCOUNTS } from '@/lib/safe/config';
import {
  fetchExecutedMultisigTransactions,
  isTransactionServiceConfigured,
} from '@/lib/safe/transaction-service';
import { logger } from '@/lib/utils/logger';

const ALLOCATION_ROWS = 200;

/** Safes whose executed history can hold vault governance calls. */
const GOVERNANCE_SAFE_ROLES = new Set(['owner', 'curator', 'sentinel', 'allocator']);

const VAULT_ACTIVITY_QUERY = gql`
  query VaultActivity($vaultAddress: String!, $chainId: Int!, $first: Int!) {
    vaultV2AllocationTransactions(
      vaultAddress: $vaultAddress
      chainId: $chainId
      first: $first
      orderBy: Timestamp
      orderDirection: Desc
    ) {
      items {
        txHash
        logIndex
        timestamp
        type
        assets
        change
        adapter
        sender
        ids
      }
    }
    vault: vaultV2ByAddress(address: $vaultAddress, chainId: $chainId) {
      pendingConfigs(first: 100) {
        items {
          functionName
          txHash
          validAt
          data
        }
      }
    }
  }
`;

type GraphResponse = {
  vaultV2AllocationTransactions?: {
    items?: Array<{
      txHash: string;
      logIndex?: number | null;
      timestamp: number | string;
      type?: string | null;
      assets?: string | number | null;
      change?: string | number | null;
      adapter?: string | null;
      sender?: string | null;
      ids?: string[] | null;
    } | null> | null;
  } | null;
  vault?: {
    pendingConfigs?: {
      items?: Array<{
        functionName?: string | null;
        txHash?: string | null;
        validAt?: number | string | null;
        data?: string | null;
      } | null> | null;
    } | null;
  } | null;
};

export type VaultActivityResponse = {
  rows: VaultActivityRow[];
  /**
   * Executed governance comes from the Muscadine role Safes' Transaction
   * Service history (Morpho does not index it). `unavailable` = no Safe API
   * key, `partial` = some Safe histories failed to load.
   */
  governanceHistory: 'complete' | 'partial' | 'unavailable';
};

async function governanceRowsFromSafes(
  vault: Address
): Promise<{ rows: VaultActivityRow[]; status: VaultActivityResponse['governanceHistory'] }> {
  if (!isTransactionServiceConfigured()) return { rows: [], status: 'unavailable' };

  const safes = SAFE_ACCOUNTS.filter((s) => GOVERNANCE_SAFE_ROLES.has(s.role));
  let failed = 0;
  const rows: VaultActivityRow[] = [];
  // Sequential: the Transaction Service free tier is 5 req/s and the client
  // already serializes through withSafeTxServiceRateLimit.
  for (const safe of safes) {
    try {
      const history = await fetchExecutedMultisigTransactions(safe.address);
      for (const tx of history) {
        if (tx.isSuccessful === false) continue;
        const names = governanceCallsFromSafeTx({ to: tx.to, data: tx.data }, vault);
        const ts = tx.executionDate ? Math.floor(Date.parse(tx.executionDate) / 1000) : 0;
        names.forEach((action, i) => {
          rows.push({
            id: `gov-${tx.safeTxHash}-${i}`,
            timestamp: ts,
            type: 'governance',
            action,
            actor: safe.address,
            amount: null,
            adapter: null,
            ids: [],
            txHash: tx.transactionHash ?? null,
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
  return { rows, status: failed === 0 ? 'complete' : 'partial' };
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
      const [data, governance] = await Promise.all([
        morphoGraphQLClient.request<GraphResponse>(VAULT_ACTIVITY_QUERY, {
          vaultAddress: vault,
          chainId,
          first: ALLOCATION_ROWS,
        }),
        governanceRowsFromSafes(vault),
      ]);

      const allocationRows: VaultActivityRow[] = (data.vaultV2AllocationTransactions?.items ?? [])
        .filter((x): x is NonNullable<typeof x> => Boolean(x?.txHash))
        .map((tx, i) => ({
          id: `alloc-${tx.txHash}-${tx.logIndex ?? i}`,
          timestamp: Number(tx.timestamp),
          type: 'allocation' as const,
          action: /dealloc/i.test(tx.type ?? '') ? 'deallocate' : 'allocate',
          actor: tx.sender ?? null,
          amount: signedAllocationAmount(tx),
          adapter: tx.adapter ?? null,
          ids: (tx.ids ?? []).filter(Boolean),
          txHash: tx.txHash,
        }));

      const pendingRows: VaultActivityRow[] = (data.vault?.pendingConfigs?.items ?? [])
        .filter((p): p is NonNullable<typeof p> => Boolean(p?.functionName))
        .map((p, i) => {
          const validAt = Number(p.validAt ?? 0);
          return {
            id: `pending-${p.txHash ?? i}-${i}`,
            timestamp: validAt,
            type: 'governance' as const,
            action: `Submit ${describeVaultCall(p.data) ?? p.functionName}`,
            actor: null,
            amount: null,
            adapter: null,
            ids: [],
            txHash: p.txHash ?? null,
            pending: { validAt },
          };
        });

      // A submit the Safe executed is also a pending config. Keep the Safe row
      // (it has the actor and execution time) and tag it with the timelock.
      const pendingByHash = new Map(
        pendingRows
          .filter((p) => p.txHash)
          .map((p) => [p.txHash!.toLowerCase(), p.pending ?? null])
      );
      const governanceRows = governance.rows.map((r) => {
        const pending = r.txHash ? pendingByHash.get(r.txHash.toLowerCase()) : undefined;
        return pending ? { ...r, pending } : r;
      });
      const executedHashes = new Set(
        governance.rows.map((r) => r.txHash?.toLowerCase()).filter(Boolean)
      );
      const pendingOnly = pendingRows.filter(
        (p) => !p.txHash || !executedHashes.has(p.txHash.toLowerCase())
      );

      return {
        rows: sortActivity([
          ...allocationRows,
          ...governanceRows,
          ...pendingOnly,
        ]),
        governanceHistory: governance.status,
      };
    },
    (result) => result.governanceHistory !== 'partial'
  );
}
