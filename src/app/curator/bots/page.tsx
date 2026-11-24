'use client';

import { AppShell } from '@/components/layout/AppShell';
import { BotWatchPanel } from '@/components/bots/BotWatchPanel';

export default function BotsPage() {
  return (
    <AppShell
      title="Bots"
      description="Allocator, sentinel, and rebater activity. Telegram alerts: @MuscadineVaultBot. Automation repos live under Curator tools."
    >
      <div className="mx-auto w-full max-w-5xl">
        <BotWatchPanel />
      </div>
    </AppShell>
  );
}
