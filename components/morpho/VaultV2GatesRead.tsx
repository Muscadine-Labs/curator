'use client';

import Link from 'next/link';
import { Lock } from 'lucide-react';
import { AddressBadge } from '@/components/AddressBadge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  CuratorErrorText,
  CuratorKvList,
  CuratorKvRow,
  CuratorPanel,
} from '@/components/morpho/CuratorChrome';
import { useVaultV2Gates } from '@/lib/hooks/useVaultV2Gates';
import { vaultGateStatuses } from '@/lib/morpho/vault-v2-gate-state';
import { cn } from '@/lib/utils';

export function VaultV2GatesRead({
  vaultAddress,
  timelocks,
}: {
  vaultAddress: string;
  timelocks?: Array<{ functionName: string; abdicatedAt: number | null }>;
}) {
  const { data, isLoading, error } = useVaultV2Gates(vaultAddress);
  const rows = vaultGateStatuses(data ?? null, timelocks ?? []);
  const sendAssetsSet = Boolean(data?.sendAssets);

  return (
    <CuratorPanel
      title="Gates"
      description={
        sendAssetsSet ? (
          <Link href="/curator/gates" className="text-xs text-blue-600 hover:underline dark:text-blue-400">
            Interact on Curator → Send-assets gate
          </Link>
        ) : undefined
      }
    >
      {isLoading && !data ? (
        <div className="p-4">
          <Skeleton className="h-24 w-full" />
        </div>
      ) : error ? (
        <div className="px-4 py-3">
          <CuratorErrorText>
            {error instanceof Error ? error.message : 'Failed to load gates'}
          </CuratorErrorText>
        </div>
      ) : (
        <CuratorKvList>
          {rows.map((gate) => (
            <CuratorKvRow key={gate.key} label={gate.label} description={gate.description}>
              <span className="inline-flex items-center justify-end gap-1.5">
                {gate.variant === 'abdicated' ? (
                  <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                ) : null}
                <span
                  className={cn(
                    gate.variant === 'abdicated' && 'text-amber-700 dark:text-amber-400',
                    gate.variant === 'none' && 'text-muted-foreground'
                  )}
                >
                  {gate.variant === 'set' && gate.address ? (
                    <AddressBadge address={gate.address} truncate />
                  ) : (
                    gate.statusLabel
                  )}
                </span>
              </span>
            </CuratorKvRow>
          ))}
        </CuratorKvList>
      )}
    </CuratorPanel>
  );
}
