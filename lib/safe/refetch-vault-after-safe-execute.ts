'use client';

import type { QueryClient } from '@tanstack/react-query';
import { getAddress } from 'viem';
import { vaultV2GovernanceQueryKey } from '@/lib/hooks/useVaultV2Governance';
import { getVaultByAddress } from '@/lib/config/vaults';
import { resolveVaultAddressFromPending } from '@/lib/safe/decode-vault-calldata-preview';
import type { SafePendingTransaction } from '@/lib/safe/types';

function resolveVaultAddress(tx: SafePendingTransaction): string | null {
  const fromSource = resolveVaultAddressFromPending(tx);
  if (fromSource) return getAddress(fromSource);
  if (getVaultByAddress(tx.to)) return getAddress(tx.to);
  return null;
}

/** Match vault Allocation / Sentinel post-tx refetch keys. */
export async function refetchVaultDataAfterSafeExecute(
  queryClient: QueryClient,
  tx: SafePendingTransaction
): Promise<void> {
  const vaultAddress = resolveVaultAddress(tx);
  if (!vaultAddress) return;

  await Promise.allSettled([
    queryClient.refetchQueries({ queryKey: ['vault-v2-risk', vaultAddress] }),
    queryClient.refetchQueries({ queryKey: vaultV2GovernanceQueryKey(vaultAddress) }),
    queryClient.refetchQueries({ queryKey: ['vault-v2-pending', vaultAddress] }),
    queryClient.refetchQueries({ queryKey: ['vault-reallocations', vaultAddress] }),
    queryClient.refetchQueries({ queryKey: ['vault', vaultAddress] }),
  ]);
}
