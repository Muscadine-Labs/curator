import { decodeEventLog, getAddress, type Address, type Hex } from 'viem';
import { vaultV2Abi } from '@/lib/onchain/abis';
import { publicClient } from '@/lib/onchain/client';
import { morphoRestList, morphoSelector } from '@/lib/morpho/rest-client';
import { withServerResponseCache } from '@/lib/api/server-response-cache';
import { API_CACHE_MAX_AGE_MS } from '@/lib/api/response-cache';
import { decodePendingCall } from '@/lib/morpho/vault-v2-pending-decode';
import type { VaultV2PendingDecoded } from '@/lib/morpho/vault-v2-api';

type RestPendingAction = {
  submitted_transaction_hash?: string | null;
  executable_at_timestamp?: number | null;
  action_type?: string | null;
};

export type PendingSubmit = {
  /** Exact calldata the curator submitted (what accept / revoke need). */
  data: Hex;
  functionName: string;
  txHash: string;
  /** On-chain `executableAt(data)`, unix seconds. */
  validAt: number;
  decoded: VaultV2PendingDecoded;
};

/**
 * Timelocked changes still pending on a Vault V2.
 *
 * Morpho GraphQL drops `pendingConfigs.data` (and the decoded cap amount) on
 * 2026-12-02, and REST `/pending-governance-actions` has no raw calldata. So:
 * REST gives the submit transaction hashes, each receipt's `Submit` events
 * from this vault give the exact calldata, and `executableAt(data)` on chain
 * keeps only what is still pending (0 once accepted or revoked). The amounts
 * shown are the chain's, never the indexer's.
 *
 * Throws when REST, a receipt or the on-chain check fails: a partial list must
 * not look complete (a missing row would hide a change from Sentinel).
 */
export function fetchVaultPendingSubmits(
  vaultAddress: string,
  chainId: number
): Promise<PendingSubmit[]> {
  const vault = getAddress(vaultAddress);
  // Shared by the pending route and the activity feed for 30s.
  return withServerResponseCache(
    `vault-pending-submits:${chainId}:${vault.toLowerCase()}`,
    API_CACHE_MAX_AGE_MS,
    () => loadPendingSubmits(vault, chainId)
  );
}

async function loadPendingSubmits(vault: string, chainId: number): Promise<PendingSubmit[]> {
  const actions = await morphoRestList<RestPendingAction>(
    `/v0/vaults-v2/${morphoSelector(chainId, vault)}/pending-governance-actions`
  );
  const txHashes = [
    ...new Set(
      actions
        .map((a) => a.submitted_transaction_hash?.toLowerCase())
        .filter((h): h is string => Boolean(h))
    ),
  ];
  if (txHashes.length === 0) return [];

  const receipts = await Promise.all(
    txHashes.map((hash) => publicClient.getTransactionReceipt({ hash: hash as Hex }))
  );

  const submits = new Map<string, { data: Hex; txHash: string }>();
  for (const receipt of receipts) {
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== vault.toLowerCase()) continue;
      let event;
      try {
        event = decodeEventLog({ abi: vaultV2Abi, data: log.data, topics: log.topics });
      } catch {
        continue;
      }
      if (event.eventName !== 'Submit') continue;
      const data = (event.args as { data: Hex }).data;
      // The same calldata can only be pending once; keep the newest submit.
      submits.set(data.toLowerCase(), { data, txHash: receipt.transactionHash });
    }
  }
  if (submits.size === 0) return [];

  const rows = [...submits.values()];
  const executableAt = await publicClient.multicall({
    allowFailure: false,
    contracts: rows.map((row) => ({
      address: vault as Address,
      abi: vaultV2Abi,
      functionName: 'executableAt' as const,
      args: [row.data] as const,
    })),
  });

  const out: PendingSubmit[] = [];
  rows.forEach((row, i) => {
    const validAt = Number(executableAt[i] as bigint);
    if (!(validAt > 0)) return;
    const call = decodePendingCall(row.data);
    out.push({
      data: row.data,
      functionName: call?.functionName ?? row.data.slice(0, 10),
      txHash: row.txHash,
      validAt,
      decoded: call?.decoded ?? { type: 'Unknown' },
    });
  });
  return out.sort((a, b) => a.validAt - b.validAt);
}
