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
    tasks.push(
      queryClient.refetchQueries({ queryKey: ['vault-v2-risk', vaultAddress] }),
      queryClient.refetchQueries({ queryKey: vaultV2GovernanceQueryKey(vaultAddress) }),
      queryClient.refetchQueries({ queryKey: ['vault-v2-pending', vaultAddress] }),
      queryClient.refetchQueries({ queryKey: ['vault-reallocations', vaultAddress] }),
      queryClient.refetchQueries({ queryKey: ['vault', vaultAddress] })
    );
  }
  if (gateAddress) {
    tasks.push(
      queryClient.refetchQueries({ queryKey: ['send-assets-gate', getAddress(gateAddress)] })
    );
  }

  await Promise.allSettled(tasks);
}
