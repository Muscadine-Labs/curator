'use client';

import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { useVaultV2Governance } from '@/lib/hooks/useVaultV2Governance';
import type { VaultV2GovernanceResponse } from '@/app/api/vaults/[id]/governance/route';
import type { VaultV2PendingResponse } from '@/app/api/vaults/[id]/pending/route';
import type { V2VaultRiskResponse } from '@/app/api/vaults/[id]/risk/route';
import { VaultV2Pending } from '@/components/morpho/VaultV2Pending';
import {
  describeVaultV2Function,
  formatAbdicatedAt,
  formatTimelockStatus,
  formatVaultV2FunctionTitle,
  isTimelockAbdicated,
} from '@/lib/morpho/vault-v2-timelocks';
import {
  CuratorEmptyText,
  CuratorErrorText,
  CuratorPageHeader,
  CuratorPanel,
  CuratorTableShell,
} from '@/components/morpho/CuratorChrome';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface VaultV2TimelocksProps {
  vaultAddress: string;
  chainId: number;
  preloadedData?: VaultV2GovernanceResponse | null;
  preloadedPending?: VaultV2PendingResponse | null;
  preloadedRisk?: V2VaultRiskResponse | null;
  assetSymbol?: string | null;
  assetDecimals?: number | null;
  /** Fee-wrapper caps already embed pending above this table. */
  showPending?: boolean;
}

export function VaultV2Timelocks({
  vaultAddress,
  chainId,
  preloadedData,
  preloadedPending,
  preloadedRisk,
  assetSymbol,
  assetDecimals,
  showPending = true,
}: VaultV2TimelocksProps) {
  const { data: fetchedData, isLoading, error } = useVaultV2Governance(vaultAddress);
  const data = preloadedData ?? fetchedData;

  if (!preloadedData && isLoading) {
    return (
      <div className="space-y-6">
        <CuratorPageHeader
          title="Timelocks"
          description="Delays governing changes on this vault. Abdicated functions are permanently disabled."
        />
        <CuratorPanel>
          <div className="space-y-3 p-4">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        </CuratorPanel>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-6">
        <CuratorPageHeader title="Timelocks" />
        <CuratorErrorText>
          Failed to load timelocks: {error instanceof Error ? error.message : 'Unknown error'}
        </CuratorErrorText>
      </div>
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
    <div className="space-y-6">
      <CuratorPageHeader
        title="Timelocks"
        description="Delays governing changes on this vault. Abdicated functions are permanently disabled and cannot be called again."
      />

      {showPending ? (
        <VaultV2Pending
          vaultAddress={vaultAddress}
          chainId={chainId}
          preloadedData={preloadedPending}
          preloadedGovernance={data}
          preloadedRisk={preloadedRisk}
          assetSymbol={assetSymbol}
          assetDecimals={assetDecimals}
          vaultSymbol={assetSymbol ?? undefined}
          embedded
          allowAccept
          allowRevoke
        />
      ) : null}

      {timelocks.length === 0 ? (
        <CuratorEmptyText>No timelocks configured.</CuratorEmptyText>
      ) : (
        <CuratorTableShell>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Function</TableHead>
                <TableHead>Delay</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {timelocks.map((t) => {
                const status = formatTimelockStatus(t.durationSeconds, t.abdicatedAt);
                const abdicated = isTimelockAbdicated(t.abdicatedAt);

                return (
                  <TableRow key={t.selector}>
                    <TableCell>
                      <p className="font-medium text-foreground">
                        {formatVaultV2FunctionTitle(t.functionName)}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {describeVaultV2Function(t.functionName, t.abdicatedAt)}
                      </p>
                      <p className="mt-1 font-mono text-[10px] text-muted-foreground">{t.selector}</p>
                    </TableCell>
                    <TableCell className="tabular-nums">
                      <span
                        className={
                          abdicated
                            ? 'font-medium text-amber-700 dark:text-amber-400'
                            : 'font-medium text-foreground'
                        }
                      >
                        {status.label}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-2">
                        {status.variant === 'instant' ? (
                          <Badge variant="outline" className="text-[10px] font-normal">
                            No delay
                          </Badge>
                        ) : null}
                        {abdicated ? (
                          <Badge variant="outline" className="text-[10px] font-normal">
                            Since {formatAbdicatedAt(t.abdicatedAt!)}
                          </Badge>
                        ) : (
                          <span className="text-sm text-muted-foreground">Active</span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CuratorTableShell>
      )}
    </div>
  );
}
