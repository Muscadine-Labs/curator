'use client';

import { AppShell } from '@/components/layout/AppShell';
import { CuratorMarketsBrowser } from '@/components/morpho/CuratorMarketsBrowser';

export default function MorphoBlueMarketsPage() {
  return (
    <AppShell
      title="Morpho Blue"
      description="Variable-rate Morpho Blue markets. Filter by network and listing status, and see Muscadine vault caps."
    >
      <CuratorMarketsBrowser product="blue" />
    </AppShell>
  );
}
