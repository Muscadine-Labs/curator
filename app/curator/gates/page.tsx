'use client';

import { Shield } from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import {
  CuratorPanel,
  CuratorSectionHeader,
} from '@/components/morpho/CuratorChrome';
import { SendAssetsGatePanel } from '@/components/morpho/SendAssetsGatePanel';
import { configuredSendAssetsGates } from '@/lib/config/deposit-gates';

export default function CuratorGatesPage() {
  const gates = configuredSendAssetsGates();

  return (
    <AppShell
      title="Send-assets gates"
      description="Shared WhitelistSendAssetsGate — Allocator and Curator Safes manage who can deposit into gated underlying vaults."
    >
      <div className="mx-auto w-full max-w-4xl space-y-8">
        <section className="space-y-3">
          <CuratorSectionHeader
            title="Gates"
            description="One gate is wired to all production underlying vaults today. Each panel below is a separate contract if more are added."
          />
          {gates.length === 0 ? (
            <CuratorPanel>
              <p className="px-4 py-3 text-sm text-muted-foreground">No gates configured.</p>
            </CuratorPanel>
          ) : (
            gates.map((gate) => (
              <SendAssetsGatePanel
                key={gate.address}
                gateAddress={gate.address}
                label={gate.label}
              />
            ))
          )}
        </section>
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Shield className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Fee wrappers stay ungated. Underlying deposits require a whitelisted msg.sender
          (wrapper adapters, Treasury, partner wallets).
        </p>
      </div>
    </AppShell>
  );
}
