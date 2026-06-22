'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { useVaultV2Governance } from '@/lib/hooks/useVaultV2Governance';
import { useVaultV2Risk } from '@/lib/hooks/useVaultV2Risk';
import {
  buildAdapterLabelMap,
  capDisplayLabel,
  capRowKey,
  formatCapRelative,
  formatCapTokenAmount,
  groupCaps,
} from '@/lib/morpho/v2-cap-format';
import type { CapInfo, VaultV2GovernanceResponse } from '@/app/api/vaults/v2/[id]/governance/route';
import type { V2VaultRiskResponse } from '@/app/api/vaults/v2/[id]/risk/route';
import type { VaultV2PendingResponse } from '@/app/api/vaults/v2/[id]/pending/route';
import { VaultV2Pending } from '@/components/morpho/VaultV2Pending';
import { formatLltvPill } from '@/components/morpho/AllocationListView';
import { marketKeyFromGraphQL } from '@/lib/morpho/morpho-app-links';

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
  const { data: fetchedRisk } = useVaultV2Risk(vaultAddress);
  const data = preloadedData ?? fetchedGov;
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
      <Card>
        <CardHeader>
          <CardTitle>Caps</CardTitle>
          <CardDescription>
            Supply caps limit how much can be allocated to each adapter, collateral token, or market.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-500 dark:text-slate-400">No caps configured.</p>
        </CardContent>
      </Card>
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
        {grouped.adapter.length > 0 && (
          <CapSection
            title="Adapter Caps"
            description="Limit the amount of assets that can be allocated to positions using specific adapters."
            caps={grouped.adapter}
            risk={risk}
            adapterLabels={adapterLabels}
            assetSymbol={assetSymbol}
            assetDecimals={assetDecimals}
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

function CapSection({
  title,
  description,
  caps,
  risk,
  adapterLabels,
  assetSymbol,
  assetDecimals,
  showLltv,
}: {
  title: string;
  description: string;
  caps: CapInfo[];
  risk: V2VaultRiskResponse | null | undefined;
  adapterLabels: Map<string, string>;
  assetSymbol?: string | null;
  assetDecimals?: number | null;
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
            lltv={showLltv ? resolveMarketLltv(cap.marketKey, risk) : null}
            assetSymbol={assetSymbol}
            assetDecimals={assetDecimals}
          />
        ))}
      </div>
    </div>
  );
}

function resolveMarketLltv(
  marketKey: string | null | undefined,
  risk: V2VaultRiskResponse | null | undefined
): string | null {
  if (!marketKey) return null;
  const needle = marketKey.toLowerCase();
  for (const adapter of risk?.adapters ?? []) {
    for (const m of adapter.markets ?? []) {
      const key = marketKeyFromGraphQL(m.market);
      if (key?.toLowerCase() === needle) {
        return formatLltvPill(m.market?.lltv ?? null);
      }
    }
  }
  return null;
}

function CapRow({
  cap,
  label,
  lltv,
  assetSymbol,
  assetDecimals,
}: {
  cap: CapInfo;
  label: string;
  lltv: string | null;
  assetSymbol?: string | null;
  assetDecimals?: number | null;
}) {
  return (
    <div className="grid grid-cols-1 gap-2 rounded-md border border-slate-200 p-3 text-sm dark:border-slate-800 sm:grid-cols-4 sm:items-center">
      <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
        <span className="font-medium text-slate-900 dark:text-slate-100">{label}</span>
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
