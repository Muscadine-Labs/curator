import { useVault } from './useProtocolStats';
import { useVaultV2Risk } from './useVaultV2Risk';
import { useVaultV2Governance } from './useVaultV2Governance';
import { useVaultV2Pending } from './useVaultV2Pending';

export function useVaultV2Complete(vaultAddress: string | null | undefined) {
  const vault = useVault(vaultAddress || '');
  const risk = useVaultV2Risk(vaultAddress);
  const governance = useVaultV2Governance(vaultAddress);
  const pending = useVaultV2Pending(vaultAddress);

  const isLoading = vault.isLoading;
  const isError = vault.isError;
  const error = vault.error;

  return {
    vault: vault.data,
    risk: risk.data,
    governance: governance.data,
    pending: pending.data,
    isLoading,
    vaultIsLoading: vault.isLoading,
    isError,
    error,
  };
}
