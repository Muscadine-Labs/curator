import { useVault } from './useProtocolStats';
import { useVaultRoles } from './useVaultRoles';
import { useVaultCaps } from './useVaultCaps';
import { useVaultQueues } from './useVaultQueues';
import { useVaultV1MarketRisk } from './useVaultV1MarketRisk';
import { useVaultV1Pending } from './useVaultV1Pending';
import type { Address } from 'viem';

export function useVaultV1Complete(vaultAddress: string | null | undefined) {
  const vault = useVault(vaultAddress || '');
  const roles = useVaultRoles((vaultAddress as Address) || undefined);
  const caps = useVaultCaps(vaultAddress);
  const queues = useVaultQueues(vaultAddress);
  const marketRisk = useVaultV1MarketRisk(vaultAddress);
  const pending = useVaultV1Pending(vaultAddress);

  // Return vault loading state separately so pages can block only on vault data
  // Other data will load in parallel and components handle their own loading states
  const isLoading = vault.isLoading || roles.isLoading || caps.isLoading || queues.isLoading || marketRisk.isLoading;
  const isError = vault.isError || roles.isError || caps.isError || queues.isError || marketRisk.isError;
  const error = vault.error || roles.error || caps.error || queues.error || marketRisk.error;

  return {
    vault: vault.data,
    roles: roles.data,
    caps: caps.data,
    queues: queues.data,
    marketRisk: marketRisk.data,
    pending: pending.data,
    isLoading,
    vaultIsLoading: vault.isLoading,
    vaultIsError: vault.isError,
    vaultError: vault.error,
    isError,
    error,
  };
}

