'use client';

import { useVaultPage } from '@/components/morpho/VaultPageShell';
import { FeeWrapperPanel } from '@/components/morpho/FeeWrapperPanel';

export default function VaultFeeWrapperPage() {
  const { vault, vaultName, feeWrapperAddress } = useVaultPage();

  return (
    <FeeWrapperPanel
      underlyingAddress={vault.address}
      feeWrapperAddress={feeWrapperAddress}
      underlyingName={vaultName}
    />
  );
}
