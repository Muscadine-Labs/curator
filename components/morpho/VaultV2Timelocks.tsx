'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { useVaultV2Governance } from '@/lib/hooks/useVaultV2Governance';
import type { VaultV2GovernanceResponse } from '@/app/api/vaults/v2/[id]/governance/route';
import {
  describeVaultV2Function,
  formatAbdicatedAt,
  formatTimelockStatus,
  formatVaultV2FunctionTitle,
  isTimelockAbdicated,
} from '@/lib/morpho/vault-v2-timelocks';

interface VaultV2TimelocksProps {
  vaultAddress: string;
  preloadedData?: VaultV2GovernanceResponse | null;
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

  const timelocks = [...data.timelocks].sort((a, b) => {
    const aAbd = isTimelockAbdicated(a.abdicatedAt);
    const bAbd = isTimelockAbdicated(b.abdicatedAt);
    if (aAbd !== bAbd) return aAbd ? 1 : -1;
    return formatVaultV2FunctionTitle(a.functionName).localeCompare(
      formatVaultV2FunctionTitle(b.functionName)
    );
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Vault Timelocks</CardTitle>
        <CardDescription>
          Timelocks governing changes on this vault. Abdicated functions are permanently disabled
          and cannot be called again.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {timelocks.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">No timelocks configured.</p>
        ) : (
          <div className="divide-y divide-slate-200 rounded-md border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
            {timelocks.map((t) => {
              const status = formatTimelockStatus(t.durationSeconds, t.abdicatedAt);
              const abdicated = isTimelockAbdicated(t.abdicatedAt);

              return (
                <div
                  key={t.selector}
                  className="grid grid-cols-1 gap-2 p-3 text-sm sm:grid-cols-3 sm:items-center"
                >
                  <div>
                    <p className="font-medium text-slate-900 dark:text-slate-100">
                      {formatVaultV2FunctionTitle(t.functionName)}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      {describeVaultV2Function(t.functionName, t.abdicatedAt)}
                    </p>
                    <p className="mt-1 font-mono text-[10px] text-slate-400 dark:text-slate-500">
                      {t.selector}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    <span
                      className={
                        abdicated
                          ? 'font-semibold text-amber-700 dark:text-amber-400'
                          : 'font-semibold text-slate-900 dark:text-slate-100'
                      }
                    >
                      {status.label}
                    </span>
                    {status.variant === 'instant' && (
                      <Badge variant="outline" className="text-xs">
                        No delay
                      </Badge>
                    )}
                    {abdicated && (
                      <Badge variant="secondary" className="text-xs">
                        Since {formatAbdicatedAt(t.abdicatedAt!)}
                      </Badge>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
