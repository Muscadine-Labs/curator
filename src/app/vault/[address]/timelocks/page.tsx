'use client';

import { useVaultPage } from '@/components/morpho/VaultPageShell';
import { VaultV2Timelocks } from '@/components/morpho/VaultV2Timelocks';

export default function VaultTimelocksPage() {
  const { vault, governance, pending, risk } = useVaultPage();

  return (
    <VaultV2Timelocks
      vaultAddress={vault.address}
      chainId={vault.chainId}
      preloadedData={governance}
      preloadedPending={pending}
      preloadedRisk={risk}
      assetSymbol={vault.asset}
      assetDecimals={vault.assetDecimals}
    />
  );
}
