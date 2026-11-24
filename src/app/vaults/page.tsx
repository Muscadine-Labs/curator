'use client';

import { AppShell } from '@/components/layout/AppShell';
import { VaultsCatalog } from '@/components/morpho/VaultsCatalog';

export default function VaultsCatalogPage() {
  return (
    <AppShell
      title="Vaults"
      description="Managed Morpho Vault V2 catalog — open a vault for curator ops (allocation, sentinel, caps, roles)."
    >
      <div className="mx-auto w-full max-w-6xl">
        <VaultsCatalog />
      </div>
    </AppShell>
  );
}
