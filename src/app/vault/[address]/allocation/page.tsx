'use client';

import { useVaultPage } from '@/components/morpho/VaultPageShell';
import { VaultV2Allocations } from '@/components/morpho/VaultV2Allocations';
import { AllocationHistory } from '@/components/morpho/AllocationHistory';

export default function VaultAllocationPage() {
  const { vault, governance, risk } = useVaultPage();

  return (
    <div className="space-y-6">
      <VaultV2Allocations
        vaultAddress={vault.address}
        chainId={vault.chainId}
        preloadedData={governance}
        preloadedRisk={risk}
      />
      <AllocationHistory
        vaultAddress={vault.address}
        chainId={vault.chainId}
        assetDecimals={vault.assetDecimals}
        assetSymbol={vault.asset}
      />
    </div>
  );
}
