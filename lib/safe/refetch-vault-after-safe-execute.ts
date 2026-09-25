'use client';

import type { QueryClient } from '@tanstack/react-query';
import { getAddress } from 'viem';
import { vaultV2GovernanceQueryKey } from '@/lib/hooks/useVaultV2Governance';
import { getVaultByAddress } from '@/lib/config/vaults';
import {
  isConfiguredGateAddress,
  resolveVaultAddressFromPending,
} from '@/lib/safe/decode-vault-calldata-preview';
import type { SafePendingTransaction } from '@/lib/safe/types';

function resolveVaultAddress(tx: SafePendingTransaction): string | null {
  const fromSource = resolveVaultAddressFromPending(tx);
  if (fromSource) return getAddress(fromSource);
  if (getVaultByAddress(tx.to)) return getAddress(tx.to);
  return null;
}

function resolveGateAddress(tx: SafePendingTransaction): string | null {
  if (tx.source?.type === 'gate') return getAddress(tx.source.gateAddress);
  try {
    const to = getAddress(tx.to);
    if (isConfiguredGateAddress(to)) return to;
  } catch {
    return null;
  }
  return null;
}

/**
 * Vault pages key their queries on whatever address the route or config held
 * (the WETH / cbBTC defaults are lowercase), and React Query keys are
 * case-sensitive — so match the address slot case-insensitively instead of
 * rebuilding keys from a checksummed address.
 */
function refetchByAddress(
  queryClient: QueryClient,
  prefixes: ReadonlyArray<string>,
  address: string
): Promise<unknown> {
  const wanted = address.toLowerCase();
  const prefixSet = new Set(prefixes);
  return queryClient.refetchQueries({
    predicate: (query) => {
      const [prefix, keyAddress] = query.queryKey;
      return (
        typeof prefix === 'string' &&
        prefixSet.has(prefix) &&
        typeof keyAddress === 'string' &&
        keyAddress.toLowerCase() === wanted
      );
    },
  });
}

const VAULT_QUERY_PREFIXES = [
  'vault-v2-risk',
  vaultV2GovernanceQueryKey(null)[0],
  'vault-v2-pending',
  'vault-reallocations',
  'vault',
] as const;

/** Match vault Allocation / Sentinel / gate post-tx refetch keys. */
export async function refetchVaultDataAfterSafeExecute(
  queryClient: QueryClient,
  tx: SafePendingTransaction
): Promise<void> {
  const vaultAddress = resolveVaultAddress(tx);
  const gateAddress = resolveGateAddress(tx);
  if (!vaultAddress && !gateAddress) return;

  const tasks: Array<Promise<unknown>> = [];
  if (vaultAddress) {
    tasks.push(refetchByAddress(queryClient, VAULT_QUERY_PREFIXES, vaultAddress));
  }
  if (gateAddress) {
    tasks.push(refetchByAddress(queryClient, ['send-assets-gate'], gateAddress));
  }

  await Promise.allSettled(tasks);
}

/** Safe header (nonce, ETH) and asset balances after an execute. */
export async function refetchSafeAfterExecute(
  queryClient: QueryClient,
  safeAddress: string
): Promise<void> {
  await refetchByAddress(queryClient, ['safe-info', 'safe-balances'], safeAddress);
}
