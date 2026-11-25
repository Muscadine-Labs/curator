'use client';

import { useVaultPage } from '@/components/morpho/VaultPageShell';
import { VaultV2Allocations } from '@/components/morpho/VaultV2Allocations';

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
    </div>
  );
}
