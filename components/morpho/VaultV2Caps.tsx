'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { CapLabel } from '@/components/morpho/CapLabel';
import { useVaultV2Governance } from '@/lib/hooks/useVaultV2Governance';
import { useVaultV2Risk } from '@/lib/hooks/useVaultV2Risk';
import {
  buildAdapterLabelMap,
  capDisplayLabel,
  capLltvPill,
  capRowKey,
  formatCapRelative,
  formatCapTokenAmount,
  groupCaps,
} from '@/lib/morpho/v2-cap-format';
import type { CapInfo, VaultV2GovernanceResponse } from '@/app/api/vaults/[id]/governance/route';
import type { V2VaultRiskResponse } from '@/app/api/vaults/[id]/risk/route';
import type { VaultV2PendingResponse } from '@/app/api/vaults/[id]/pending/route';
import { VaultV2Pending } from '@/components/morpho/VaultV2Pending';
import { formatMaxRateApr } from '@/lib/morpho/vault-v2-api';

interface VaultV2CapsProps {
  vaultAddress: string;
  chainId: number;
  preloadedData?: VaultV2GovernanceResponse | null;
  preloadedRisk?: V2VaultRiskResponse | null;
  preloadedPending?: VaultV2PendingResponse | null;
  assetSymbol?: string | null;
  assetDecimals?: number | null;
}

export function VaultV2Caps({
  vaultAddress,
  chainId,
  preloadedData,
  preloadedRisk,
  preloadedPending,
  assetSymbol,
  assetDecimals,
}: VaultV2CapsProps) {
  const { data: fetchedGov, isLoading: govLoading, error: govError } = useVaultV2Governance(vaultAddress);
  const { data: fetchedRisk } = useVaultV2Risk(vaultAddress, {
    initialData: preloadedRisk ?? undefined,
  });
  const data = fetchedGov ?? preloadedData;
  const risk = preloadedRisk ?? fetchedRisk;

  if (!preloadedData && govLoading) {
    return <CapsSkeleton />;
  }

  if (govError || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Caps</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-red-600 dark:text-red-400">
            Failed to load caps: {govError instanceof Error ? govError.message : 'Unknown error'}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (data.caps.length === 0) {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Caps</CardTitle>
            <CardDescription>
              Supply caps limit how much can be allocated to each adapter, collateral token, or market.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <MaxRateBlock maxRate={data.maxRate} />
            <p className="text-sm text-slate-500 dark:text-slate-400">No caps configured.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const adapterLabels = buildAdapterLabelMap(data.adapters);
  const grouped = groupCaps(data.caps);
  const pendingCount = preloadedPending?.pending?.length ?? 0;

  return (
    <div className="space-y-6">
      {pendingCount > 0 && (
        <VaultV2Pending
          vaultAddress={vaultAddress}
          chainId={chainId}
          preloadedData={preloadedPending}
        />
      )}
    <Card>
      <CardHeader>
        <CardTitle>Caps</CardTitle>
        <CardDescription>
          Supply caps limit how much can be allocated to each adapter, collateral token, or market.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-8">
        <MaxRateBlock maxRate={data.maxRate} />
        {grouped.adapter.length > 0 && (
          <CapSection
            title="Adapter Caps"
            description="Limit the amount of assets that can be allocated to positions using specific adapters."
            caps={grouped.adapter}
            risk={risk}
            adapterLabels={adapterLabels}
            assetSymbol={assetSymbol}
            assetDecimals={assetDecimals}
            chainId={chainId}
          />
        )}
        {grouped.collateral.length > 0 && (
          <CapSection
            title="Collateral Token Caps"
            description="Limit the amount of assets that can be allocated to positions using specific collateral tokens."
            caps={grouped.collateral}
            risk={risk}
            adapterLabels={adapterLabels}
            assetSymbol={assetSymbol}
            assetDecimals={assetDecimals}
            chainId={chainId}
          />
        )}
        {grouped.market.length > 0 && (
          <CapSection
            title="Market Caps"
            description="Limit the amount of assets that can be allocated to specific Morpho markets."
            caps={grouped.market}
            risk={risk}
            adapterLabels={adapterLabels}
            assetSymbol={assetSymbol}
            assetDecimals={assetDecimals}
            chainId={chainId}
            showLltv
          />
        )}
      </CardContent>
    </Card>
    </div>
  );
}

function CapsSkeleton() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Caps</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </CardContent>
    </Card>
  );
}

function MaxRateBlock({ maxRate }: { maxRate: string | null }) {
  if (maxRate == null) return null;
  return (
    <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Max Rate</p>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
        Maximum interest rate the vault can charge on allocated assets (annualized APR).
      </p>
      <p className="mt-2 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">
        {formatMaxRateApr(maxRate)}
      </p>
    </div>
  );
}

function CapSection({
  title,
  description,
  caps,
  risk,
  adapterLabels,
  assetSymbol,
  assetDecimals,
  chainId,
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
  showLltv?: boolean;
}) {
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400">{description}</p>
      </div>
      <div className="space-y-2">
        {caps.map((cap, idx) => (
          <CapRow
            key={capRowKey(cap, idx)}
            cap={cap}
            label={capDisplayLabel(cap, risk, adapterLabels)}
            lltv={showLltv ? capLltvPill(cap, risk) : null}
            assetSymbol={assetSymbol}
            assetDecimals={assetDecimals}
            chainId={chainId}
          />
        ))}
      </div>
    </div>
  );
}

function CapRow({
  cap,
  label,
  lltv,
  assetSymbol,
  assetDecimals,
  chainId,
}: {
  cap: CapInfo;
  label: string;
  lltv: string | null;
  assetSymbol?: string | null;
  assetDecimals?: number | null;
  chainId: number;
}) {
  return (
    <div className="grid grid-cols-1 gap-2 rounded-md border border-slate-200 p-3 text-sm dark:border-slate-800 sm:grid-cols-4 sm:items-center">
      <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
        <span className="font-medium text-slate-900 dark:text-slate-100">
          <CapLabel cap={cap} label={label} chainId={chainId} />
        </span>
        {lltv && (
          <Badge variant="outline" className="text-xs text-slate-600 dark:text-slate-300">
            {lltv}
          </Badge>
        )}
      </div>
      <div>
        <p className="text-xs text-slate-500 dark:text-slate-400">Allocation</p>
        <p className="font-semibold tabular-nums">
          {formatCapTokenAmount(cap.allocation, assetSymbol, assetDecimals)}
        </p>
      </div>
      <div>
        <p className="text-xs text-slate-500 dark:text-slate-400">Absolute / Relative</p>
        <p className="font-semibold tabular-nums">
          {formatCapTokenAmount(cap.absoluteCap, assetSymbol, assetDecimals)}
        </p>
        <p className="text-xs text-slate-600 dark:text-slate-300">{formatCapRelative(cap.relativeCap)}</p>
      </div>
    </div>
  );
}
