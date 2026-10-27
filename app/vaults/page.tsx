'use client';

import { AppShell } from '@/components/layout/AppShell';
import { VaultsCatalog } from '@/components/morpho/VaultsCatalog';

export default function VaultsCatalogPage() {
  return (
    <AppShell
      title="Vaults"
      description="Morpho Vault V2 catalog — allocations, caps, and risk."
    >
      <div className="mx-auto w-full max-w-6xl">
        <VaultsCatalog />
      </div>
    </AppShell>
  );
}
