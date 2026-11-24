'use client';

import { useVaultPage } from '@/components/morpho/VaultPageShell';
import { VaultV2Sentinel } from '@/components/morpho/VaultV2Sentinel';

export default function VaultSentinelPage() {
  const { vault, governance, risk, pending, emergencyActionsUrl } = useVaultPage();

  return (
    <VaultV2Sentinel
      vaultAddress={vault.address}
      chainId={vault.chainId}
      preloadedGovernance={governance}
      preloadedRisk={risk}
      preloadedPending={pending}
      assetSymbol={vault.asset}
      assetDecimals={vault.assetDecimals}
      emergencyActionsUrl={emergencyActionsUrl}
    />
  );
}
