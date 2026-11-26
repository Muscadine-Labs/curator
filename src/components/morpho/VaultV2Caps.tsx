'use client';

import { useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { CapLabel } from '@/components/morpho/CapLabel';
import { CapUtilizationRing } from '@/components/morpho/CapUtilizationRing';
import { useVaultV2Governance } from '@/lib/hooks/useVaultV2Governance';
import { useVaultV2Risk } from '@/lib/hooks/useVaultV2Risk';
import {
  buildAdapterLabelMap,
  capDisplayLabel,
  capLltvPill,
  capRowKey,
  formatCapCompactAmount,
  formatCapRelative,
  groupCaps,
  sortCapsByAllocationDesc,
  absoluteCapUtilizationPercent,
  relativeCapUtilizationPercent,
} from '@/lib/morpho/v2-cap-format';
import { PublicAllocatorCaps } from '@/components/morpho/PublicAllocatorCaps';
import { formatMaxRateApr } from '@/lib/morpho/vault-v2-api';
import type { CapInfo, VaultV2GovernanceResponse } from '@/app/api/vaults/[id]/governance/route';
import type { V2VaultRiskResponse } from '@/app/api/vaults/[id]/risk/route';
import type { VaultV2PendingResponse } from '@/app/api/vaults/[id]/pending/route';
import { VaultV2Pending } from '@/components/morpho/VaultV2Pending';
import {
  CuratorEmptyText,
  CuratorErrorText,
  CuratorPageHeader,
  CuratorPanel,
  CuratorSectionHeader,
  CuratorSegmented,
  CuratorSegmentedButton,
  CuratorTableShell,
} from '@/components/morpho/CuratorChrome';

interface VaultV2CapsProps {
  vaultAddress: string;
  chainId: number;
  preloadedData?: VaultV2GovernanceResponse | null;
  preloadedRisk?: V2VaultRiskResponse | null;
  preloadedPending?: VaultV2PendingResponse | null;
  assetSymbol?: string | null;
  assetDecimals?: number | null;
  totalAssetsUnderlying?: string | null;
}

type CapsView = 'vault' | 'publicAllocator';

export function VaultV2Caps({
  vaultAddress,
  chainId,
  preloadedData,
  preloadedRisk,
  preloadedPending,
  assetSymbol,
  assetDecimals,
  totalAssetsUnderlying,
}: VaultV2CapsProps) {
  const { data: fetchedGov, isLoading: govLoading, error: govError } = useVaultV2Governance(vaultAddress);
  const { data: fetchedRisk } = useVaultV2Risk(vaultAddress, {
    initialData: preloadedRisk ?? undefined,
  });
  const data = fetchedGov ?? preloadedData;
  const risk = preloadedRisk ?? fetchedRisk;
  const [view, setView] = useState<CapsView>('vault');

  if (!preloadedData && govLoading) {
    return <CapsSkeleton />;
  }

  if (govError || !data) {
    return (
      <div className="space-y-6">
        <CuratorPageHeader title="Caps" />
        <CuratorErrorText>
          Failed to load caps: {govError instanceof Error ? govError.message : 'Unknown error'}
        </CuratorErrorText>
      </div>
    );
  }

  const publicAllocator = data.publicAllocator;
  const hasPublicAllocator = publicAllocator != null;
  const adapterLabels = buildAdapterLabelMap(data.adapters);
  const grouped = groupCaps(data.caps);
  const pendingCount = preloadedPending?.pending?.length ?? 0;

  return (
    <div className="space-y-6">
      <CuratorPageHeader
        title="Caps"
        description={
          <>
            {view === 'publicAllocator'
              ? 'Cap the total allocation each market can hold after a Public Allocator move, and choose which markets it can deallocate from.'
              : 'Supply and borrow limits for adapters, collateral tokens, and Morpho markets. Vault caps still bind Public Allocator moves.'}
            {pendingCount > 0
              ? ' Accept executable timelock actions below — any connected wallet or multisig Safe may submit after the waiting period.'
              : ''}
          </>
        }
      />

      {pendingCount > 0 ? (
        <VaultV2Pending
          vaultAddress={vaultAddress}
          chainId={chainId}
          preloadedData={preloadedPending}
          preloadedGovernance={data}
          preloadedRisk={risk}
          assetSymbol={assetSymbol}
          assetDecimals={assetDecimals}
          vaultSymbol={assetSymbol ?? undefined}
          embedded
          compactEmbedded
          allowAccept
        />
      ) : null}

      {hasPublicAllocator ? (
        <CuratorSegmented>
          <CuratorSegmentedButton active={view === 'vault'} onClick={() => setView('vault')}>
            Vault
          </CuratorSegmentedButton>
          <CuratorSegmentedButton
            active={view === 'publicAllocator'}
            onClick={() => setView('publicAllocator')}
          >
            Public Allocator
          </CuratorSegmentedButton>
        </CuratorSegmented>
      ) : null}

      {view === 'publicAllocator' && publicAllocator ? (
        <PublicAllocatorCaps
          vaultAddress={vaultAddress}
          chainId={chainId}
          allocators={data.allocators}
          state={publicAllocator}
          caps={grouped.market}
          risk={risk}
          adapterLabels={adapterLabels}
          assetSymbol={assetSymbol}
          assetDecimals={assetDecimals}
        />
      ) : data.caps.length === 0 ? (
        <div className="space-y-4">
          <MaxRateBlock maxRate={data.maxRate} />
          <CuratorEmptyText>No caps configured.</CuratorEmptyText>
        </div>
      ) : (
        <div className="space-y-8">
          <MaxRateBlock maxRate={data.maxRate} />
          {grouped.market.length > 0 ? (
            <CapTableSection
              title="Variable rate markets"
              description="Limit the amount of assets that can be allocated to specific Morpho markets."
              caps={grouped.market}
              risk={risk}
              adapterLabels={adapterLabels}
              assetSymbol={assetSymbol}
              assetDecimals={assetDecimals}
              chainId={chainId}
              totalAssetsUnderlying={totalAssetsUnderlying}
              showLltv
            />
          ) : null}
          {grouped.collateral.length > 0 ? (
            <CapTableSection
              title="Collateral tokens"
              description="Limit the amount of assets that can be allocated to positions using specific collateral tokens."
              caps={grouped.collateral}
              risk={risk}
              adapterLabels={adapterLabels}
              assetSymbol={assetSymbol}
              assetDecimals={assetDecimals}
              chainId={chainId}
              totalAssetsUnderlying={totalAssetsUnderlying}
            />
          ) : null}
          {grouped.adapter.length > 0 ? (
            <CapTableSection
              title="Adapters"
              description="Limit the amount of assets that can be allocated to positions using specific adapters."
              caps={grouped.adapter}
              risk={risk}
              adapterLabels={adapterLabels}
              assetSymbol={assetSymbol}
              assetDecimals={assetDecimals}
              chainId={chainId}
              totalAssetsUnderlying={totalAssetsUnderlying}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

function CapsSkeleton() {
  return (
    <div className="space-y-6">
      <CuratorPageHeader title="Caps" />
      <CuratorPanel>
        <div className="space-y-3 p-4">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      </CuratorPanel>
    </div>
  );
}

function MaxRateBlock({ maxRate }: { maxRate: string | null }) {
  if (maxRate == null) return null;
  return (
    <CuratorPanel title="Max rate" description="Caps how fast the vault's assets can grow to avoid yield spikes.">
      <p className="px-4 py-3 text-lg font-semibold tabular-nums">{formatMaxRateApr(maxRate)}</p>
    </CuratorPanel>
  );
}

function CapTableSection({
  title,
  description,
  caps,
  risk,
  adapterLabels,
  assetSymbol,
  assetDecimals,
  chainId,
  totalAssetsUnderlying,
  showLltv,
}: {
  title: string;
  description: string;
  caps: CapInfo[];
  risk: V2VaultRiskResponse | null | undefined;
  adapterLabels: Map<string, string>;
  assetSymbol?: string | null;
  assetDecimals?: number | null;
  chainId: number;
  totalAssetsUnderlying?: string | null;
  showLltv?: boolean;
}) {
  const rows = sortCapsByAllocationDesc(caps);
  return (
    <div className="space-y-3">
      <CuratorSectionHeader title={title} count={rows.length} description={description} />
      <CuratorTableShell>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Name</TableHead>
              <TableHead>Allocation</TableHead>
              <TableHead>Absolute cap</TableHead>
              <TableHead>Relative cap</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((cap, idx) => (
              <TableRow key={capRowKey(cap, idx)}>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">
                      <CapLabel
                        cap={cap}
                        label={capDisplayLabel(cap, risk, adapterLabels)}
                        chainId={chainId}
                      />
                    </span>
                    {showLltv ? (
                      capLltvPill(cap, risk) ? (
                        <Badge variant="outline" className="text-[10px] font-normal">
                          {capLltvPill(cap, risk)}
                        </Badge>
                      ) : null
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="tabular-nums">
                  {formatCapCompactAmount(cap.allocation, assetSymbol, assetDecimals)}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5 tabular-nums">
                    {formatCapCompactAmount(cap.absoluteCap, assetSymbol, assetDecimals)}
                    <CapUtilizationRing
                      percent={absoluteCapUtilizationPercent(cap.allocation, cap.absoluteCap)}
                    />
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5 tabular-nums">
                    {formatCapRelative(cap.relativeCap)}
                    <CapUtilizationRing
                      percent={relativeCapUtilizationPercent(
                        cap.allocation,
                        cap.relativeCap,
                        totalAssetsUnderlying
                      )}
                    />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CuratorTableShell>
    </div>
  );
}
