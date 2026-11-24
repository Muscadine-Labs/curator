'use client';

import { useVaultPage } from '@/components/morpho/VaultPageShell';
import { VaultAnalyticsPanel } from '@/components/morpho/VaultAnalyticsPanel';

export default function VaultAnalyticsPage() {
  const { vault, risk } = useVaultPage();

  return <VaultAnalyticsPanel vault={vault} risk={risk} />;
}
