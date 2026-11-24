'use client';

import { useVaultPage } from '@/components/morpho/VaultPageShell';
import { VaultOverviewPanel } from '@/components/morpho/VaultOverviewPanel';

export default function VaultOverviewPage() {
  const { vault, vaultSymbol, vaultAsset, governance, risk } = useVaultPage();

  return (
    <VaultOverviewPanel
      vault={vault}
      vaultSymbol={vaultSymbol}
      vaultAsset={vaultAsset}
      governance={governance}
      risk={risk}
    />
  );
}
