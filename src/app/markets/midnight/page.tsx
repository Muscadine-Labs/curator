'use client';

import { AppShell } from '@/components/layout/AppShell';
import { CuratorMarketsBrowser } from '@/components/morpho/CuratorMarketsBrowser';

export default function MidnightMarketsPage() {
  return (
    <AppShell
      title="Midnight"
      description="Fixed-rate Midnight markets. Filter by network and pair, and open a market for curator detail."
    >
      <CuratorMarketsBrowser product="midnight" />
    </AppShell>
  );
}
