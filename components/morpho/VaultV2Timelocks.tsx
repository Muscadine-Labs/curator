'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { useVaultV2Governance } from '@/lib/hooks/useVaultV2Governance';
import type { VaultV2GovernanceResponse } from '@/app/api/vaults/v2/[id]/governance/route';

interface VaultV2TimelocksProps {
  vaultAddress: string;
  preloadedData?: VaultV2GovernanceResponse | null;
}

function formatTimelockDuration(seconds: number): string {
  if (seconds === 0) return 'Instant';
  const days = Math.floor(seconds / 86400);
  if (days >= 1 && seconds % 86400 === 0) return `${days} day${days === 1 ? '' : 's'}`;
  const hours = Math.floor((seconds % 86400) / 3600);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h`;
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${minutes}m`;
}

export function VaultV2Timelocks({ vaultAddress, preloadedData }: VaultV2TimelocksProps) {
  const { data: fetchedData, isLoading, error } = useVaultV2Governance(vaultAddress);
  const data = preloadedData ?? fetchedData;

  if (!preloadedData && isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Vault Timelocks</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Vault Timelocks</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-red-600 dark:text-red-400">
            Failed to load timelocks: {error instanceof Error ? error.message : 'Unknown error'}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Vault Timelocks</CardTitle>
        <CardDescription>
          Timelocks governing changes on this vault. Multiple changes can be batched into a single
          transaction on Morpho Curator.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {data.timelocks.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">No timelocks configured.</p>
        ) : (
          <div className="divide-y divide-slate-200 rounded-md border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
            {data.timelocks.map((t) => (
              <div
                key={t.selector}
                className="grid grid-cols-1 gap-2 p-3 text-sm sm:grid-cols-3 sm:items-center"
              >
                <div>
                  <p className="font-medium text-slate-900 dark:text-slate-100">{t.functionName}</p>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    {humanizeFunctionName(t.functionName)}
                  </p>
                </div>
                <div className="font-mono text-xs text-slate-600 dark:text-slate-300">{t.selector}</div>
                <div className="flex items-center justify-between gap-2 sm:justify-end">
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    {formatTimelockDuration(t.durationSeconds)}
                  </span>
                  {t.durationSeconds === 0 && (
                    <Badge variant="outline" className="text-xs">
                      No delay
                    </Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function humanizeFunctionName(name: string): string {
  const map: Record<string, string> = {
    abdicate: 'Permanently prevent a specific curator function from ever being called again',
    addAdapter: "Add a new adapter to the vault's enabled allocation set",
    increaseAbsoluteCap: 'Raise the maximum absolute amount allocatable to an allocation',
    increaseRelativeCap: 'Raise the maximum percentage of vault assets allocatable to an allocation',
    increaseTimelock: 'Increase the waiting period before a timelocked change takes effect',
    removeAdapter: "Remove an adapter from the vault's enabled allocation set",
    setAdapterRegistry: 'Change the registry contract that validates vault adapters',
    setForceDeallocatePenalty: 'Change the penalty applied when force-deallocating from an adapter',
    setIsAllocator: 'Grant or revoke allocator permissions for an address',
    setManagementFee: 'Change the annual fee rate charged continuously on total vault assets',
    setManagementFeeRecipient: 'Change the address that receives management fee payments',
    setPerformanceFee: 'Change the fee rate charged on vault interest, collected at accrual',
    setPerformanceFeeRecipient: 'Change the address that receives performance fee payments',
    setReceiveAssetsGate: 'Change the gate that controls which addresses can receive withdrawn assets',
    setReceiveSharesGate: 'Change the gate that controls which addresses can receive vault shares',
    setSendAssetsGate: 'Change the gate that controls which addresses can deposit assets',
    setSendSharesGate: 'Change the gate that controls which addresses can send vault shares',
  };
  return map[name] ?? '';
}
