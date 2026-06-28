'use client';

import { AppShell } from '@/components/layout/AppShell';
import { CuratorMarketsBrowser } from '@/components/morpho/CuratorMarketsBrowser';

export default function CuratorMarketsPage() {
  return (
    <AppShell
      title="Morpho Markets"
      description="Browse Morpho Blue markets, filter by network and listing status, and see Muscadine vault caps."
    >
      <CuratorMarketsBrowser />
    </AppShell>
  );
}
