'use client';

import type { VaultDetail } from '@/lib/hooks/useProtocolStats';
import { VaultRiskV2 } from '@/components/morpho/VaultRiskV2';

interface VaultAnalyticsPanelProps {
  vault: VaultDetail;
  risk?: import('@/app/api/vaults/[id]/risk/route').V2VaultRiskResponse | null;
}

export function VaultAnalyticsPanel({ vault, risk }: VaultAnalyticsPanelProps) {
  return (
    <VaultRiskV2
      vaultAddress={vault.address}
      chainId={vault.chainId}
      preloadedData={risk}
    />
  );
}
