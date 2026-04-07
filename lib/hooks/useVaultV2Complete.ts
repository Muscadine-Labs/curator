import { useVault } from './useProtocolStats';
import { useVaultV2Risk } from './useVaultV2Risk';
import { useVaultV2Governance } from './useVaultV2Governance';

export function useVaultV2Complete(vaultAddress: string | null | undefined) {
  const vault = useVault(vaultAddress || '');
  const risk = useVaultV2Risk(vaultAddress);
  const governance = useVaultV2Governance(vaultAddress);

  // Only block on vault data \u2013 risk & governance load in parallel and their
  // components handle their own loading/error states independently
  const isLoading = vault.isLoading;
  const isError = vault.isError;
  const error = vault.error;

  return {
    vault: vault.data,
    risk: risk.data,
    governance: governance.data,
    isLoading,
    vaultIsLoading: vault.isLoading, // Separate vault loading state
    isError,
    error,
  };
}

