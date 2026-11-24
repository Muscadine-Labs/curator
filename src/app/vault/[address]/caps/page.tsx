'use client';

import { useVaultPage } from '@/components/morpho/VaultPageShell';
import { VaultV2Caps } from '@/components/morpho/VaultV2Caps';

export default function VaultCapsPage() {
  const { vault, governance, risk, pending } = useVaultPage();

  return (
    <VaultV2Caps
      vaultAddress={vault.address}
      chainId={vault.chainId}
      preloadedData={governance}
      preloadedRisk={risk}
      preloadedPending={pending}
      assetSymbol={vault.asset}
      assetDecimals={vault.assetDecimals}
      totalAssetsUnderlying={
        vault.analytics?.totalAssetsUnderlying ?? vault.totalAssetsUnderlying
      }
    />
  );
}
