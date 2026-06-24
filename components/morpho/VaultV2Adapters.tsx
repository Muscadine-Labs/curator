'use client';

import { useMemo, useState } from 'react';
import { LayoutGrid, List, Zap } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { AddressBadge } from '@/components/AddressBadge';
import { useVaultV2Governance } from '@/lib/hooks/useVaultV2Governance';
import { useVaultV2Risk } from '@/lib/hooks/useVaultV2Risk';
import { formatPercentage, formatRawTokenAmount, formatUSD } from '@/lib/format/number';
import {
  getTokenDisplayDecimals,
  resolveAssetDecimals,
} from '@/lib/format/asset-decimals';
import {
  formatCapRelative,
  formatCapTokenAmount,
} from '@/lib/morpho/v2-cap-format';
import { formatForceDeallocatePenaltyWad } from '@/lib/morpho/vault-v2-api';
import { isAdapterCap } from '@/lib/morpho/cap-utils';
import type { AdapterInfo, VaultV2GovernanceResponse } from '@/app/api/vaults/v2/[id]/governance/route';
import type { V2AdapterRiskData, V2VaultRiskResponse } from '@/app/api/vaults/v2/[id]/risk/route';

interface VaultV2AdaptersProps {
  vaultAddress: string;
  preloadedData?: VaultV2GovernanceResponse | null;
  preloadedRisk?: V2VaultRiskResponse | null;
  assetSymbol?: string | null;
  assetDecimals?: number | null;
}

type ViewMode = 'card' | 'table';

export function VaultV2Adapters({
  vaultAddress,
  preloadedData,
  preloadedRisk,
  assetSymbol,
  assetDecimals,
}: VaultV2AdaptersProps) {
  const { data: fetchedGov, isLoading: govLoading, error: govError } = useVaultV2Governance(vaultAddress);
  const { data: fetchedRisk, isLoading: riskLoading } = useVaultV2Risk(vaultAddress);
  const data = fetchedGov ?? preloadedData;
  const risk = fetchedRisk ?? preloadedRisk;
  const [viewMode, setViewMode] = useState<ViewMode>('card');

  const liquidityAdapterAddress = data?.liquidityAdapter?.address?.toLowerCase();

  const adapters = useMemo<AdapterInfo[]>(() => {
    if (!data?.adapters) return [];
    return [...data.adapters].sort((a, b) => (b.assetsUsd ?? 0) - (a.assetsUsd ?? 0));
  }, [data?.adapters]);

  const riskByAdapter = useMemo(() => {
    const map = new Map<string, V2AdapterRiskData>();
    for (const a of risk?.adapters ?? []) {
      map.set(a.adapterAddress.toLowerCase(), a);
    }
    return map;
  }, [risk?.adapters]);

  const capByAdapter = useMemo(() => {
    const map = new Map<string, { absolute: string; relative: string; allocation: string }>();
    if (!data?.caps) return map;
    for (const cap of data.caps) {
      if (!isAdapterCap(cap) || !cap.adapterAddress) continue;
      map.set(cap.adapterAddress.toLowerCase(), {
        absolute: cap.absoluteCap,
        relative: cap.relativeCap,
        allocation: cap.allocation,
      });
    }
    return map;
  }, [data?.caps]);

  const totalUsd = useMemo(() => {
    const idle = data?.idleAssetsUsd ?? 0;
    const strat = adapters.reduce((s, a) => s + (a.assetsUsd ?? 0), 0);
    return idle + strat;
  }, [data?.idleAssetsUsd, adapters]);

  if ((!preloadedData && govLoading) || (!preloadedRisk && riskLoading)) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Active Morpho Adapters</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (govError || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Active Morpho Adapters</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-red-600 dark:text-red-400">
            Failed to load adapters: {govError instanceof Error ? govError.message : 'Unknown error'}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Active Morpho Adapters</CardTitle>
          <div className="flex gap-1">
            <Button
              size="sm"
              variant={viewMode === 'card' ? 'default' : 'outline'}
              onClick={() => setViewMode('card')}
            >
              <LayoutGrid className="mr-1 h-3.5 w-3.5" />
              Card view
            </Button>
            <Button
              size="sm"
              variant={viewMode === 'table' ? 'default' : 'outline'}
              onClick={() => setViewMode('table')}
            >
              <List className="mr-1 h-3.5 w-3.5" />
              Table view
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {data.liquidityAdapter?.address && (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm">
            <span className="font-medium text-emerald-800 dark:text-emerald-300">Liquidity adapter: </span>
            <AddressBadge address={data.liquidityAdapter.address} truncate={false} />
          </div>
        )}

        {viewMode === 'card' ? (
          <div className="space-y-4">
            <IdleAdapterCard
              idleAssets={data.idleAssets}
              idleAssetsUsd={data.idleAssetsUsd}
              totalUsd={totalUsd}
              assetSymbol={assetSymbol}
              assetDecimals={assetDecimals}
            />
            {adapters.map((adapter) => (
              <StrategyAdapterCard
                key={adapter.address}
                adapter={adapter}
                risk={riskByAdapter.get(adapter.address.toLowerCase())}
                cap={capByAdapter.get(adapter.address.toLowerCase())}
                isLiquidity={adapter.address.toLowerCase() === liquidityAdapterAddress}
                totalUsd={totalUsd}
                assetSymbol={assetSymbol}
                assetDecimals={assetDecimals}
              />
            ))}
          </div>
        ) : (
          <AdapterTable
            idleAssets={data.idleAssets}
            idleAssetsUsd={data.idleAssetsUsd}
            adapters={adapters}
            riskByAdapter={riskByAdapter}
            capByAdapter={capByAdapter}
            liquidityAdapterAddress={liquidityAdapterAddress}
            totalUsd={totalUsd}
            assetSymbol={assetSymbol}
            assetDecimals={assetDecimals}
          />
        )}
      </CardContent>
    </Card>
  );
}

function pctOfTotal(amountUsd: number, totalUsd: number): string {
  if (totalUsd <= 0) return '0%';
  return `${((amountUsd / totalUsd) * 100).toFixed(1)}%`;
}

function IdleAdapterCard({
  idleAssets,
  idleAssetsUsd,
  totalUsd,
  assetSymbol,
  assetDecimals,
}: {
  idleAssets: string | null;
  idleAssetsUsd: number | null;
  totalUsd: number;
  assetSymbol?: string | null;
  assetDecimals?: number | null;
}) {
  const chainDecimals = resolveAssetDecimals(assetSymbol ?? undefined, assetDecimals ?? undefined);
  const displayDecimals = getTokenDisplayDecimals(assetSymbol ?? undefined, chainDecimals);
  const usd = idleAssetsUsd ?? 0;

  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50/80 p-4 dark:border-slate-700 dark:bg-slate-900/50">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-slate-900 dark:text-slate-100">Idle</p>
            <Badge variant="outline" className="text-xs">Idle Adapter</Badge>
            <Badge className="bg-emerald-600 text-xs text-white">Active</Badge>
          </div>
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <Metric label="Allocation / %" value={`${formatToken(idleAssets, chainDecimals, displayDecimals, assetSymbol)} / ${pctOfTotal(usd, totalUsd)}`} />
        <Metric label="Absolute / Relative Cap" value="Infinite / 100%" />
        <Metric label="Liquidity" value={formatToken(idleAssets, chainDecimals, displayDecimals, assetSymbol)} />
      </dl>
    </div>
  );
}

function StrategyAdapterCard({
  adapter,
  risk,
  cap,
  isLiquidity,
  totalUsd,
  assetSymbol,
  assetDecimals,
}: {
  adapter: AdapterInfo;
  risk?: V2AdapterRiskData;
  cap?: { absolute: string; relative: string; allocation: string };
  isLiquidity: boolean;
  totalUsd: number;
  assetSymbol?: string | null;
  assetDecimals?: number | null;
}) {
  const label =
    adapter.metaMorpho?.name ??
    adapter.metaMorpho?.symbol ??
    (adapter.type === 'MetaMorpho' || adapter.type === 'MetaMorphoAdapter'
      ? 'MetaMorpho Adapter'
      : 'Variable Rate Market Adapter');

  const chainDecimals = resolveAssetDecimals(assetSymbol ?? undefined, assetDecimals ?? undefined);
  const displayDecimals = getTokenDisplayDecimals(assetSymbol ?? undefined, chainDecimals);
  const usd = adapter.assetsUsd ?? 0;
  const marketsCount = risk?.markets?.length ?? 0;
  const rate = resolveAdapterRate(risk);
  const liquidity = resolveAdapterLiquidity(risk, adapter);

  const allocStr = formatTokenFromAssets(adapter.assets, chainDecimals, displayDecimals, assetSymbol);

  return (
    <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-slate-900 dark:text-slate-100">{label}</p>
            {isLiquidity && (
              <Badge className="flex items-center gap-1 bg-emerald-600 text-white">
                <Zap className="h-3 w-3" />
                Liquidity Adapter
              </Badge>
            )}
            <Badge className="bg-emerald-600 text-xs text-white">Active</Badge>
          </div>
          <AddressBadge address={adapter.address} truncate={false} />
          {marketsCount > 0 && (
            <p className="text-xs text-slate-500 dark:text-slate-400">Underlying: {marketsCount} markets</p>
          )}
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
        <Metric label="Allocation / %" value={`${allocStr} / ${pctOfTotal(usd, totalUsd)}`} />
        <Metric
          label="Absolute / Relative Cap"
          value={
            cap
              ? `${formatCapTokenAmount(cap.absolute, assetSymbol, assetDecimals)} / ${formatCapRelative(cap.relative)}`
              : '—'
          }
        />
        <Metric label="Liquidity" value={liquidity} />
        {rate != null && <Metric label="Rate" value={formatPercentage(rate * 100, 2)} />}
        <Metric
          label="Force Deallocate Penalty"
          value={formatForceDeallocatePenaltyWad(adapter.forceDeallocatePenalty)}
        />
      </dl>
    </div>
  );
}

function AdapterTable({
  idleAssets,
  idleAssetsUsd,
  adapters,
  riskByAdapter,
  capByAdapter,
  liquidityAdapterAddress,
  totalUsd,
  assetSymbol,
  assetDecimals,
}: {
  idleAssets: string | null;
  idleAssetsUsd: number | null;
  adapters: AdapterInfo[];
  riskByAdapter: Map<string, V2AdapterRiskData>;
  capByAdapter: Map<string, { absolute: string; relative: string; allocation: string }>;
  liquidityAdapterAddress?: string;
  totalUsd: number;
  assetSymbol?: string | null;
  assetDecimals?: number | null;
}) {
  const chainDecimals = resolveAssetDecimals(assetSymbol ?? undefined, assetDecimals ?? undefined);
  const displayDecimals = getTokenDisplayDecimals(assetSymbol ?? undefined, chainDecimals);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs text-slate-500 dark:border-slate-800">
            <th className="pb-2 pr-3 font-medium">Adapter</th>
            <th className="pb-2 pr-3 font-medium">Allocation / %</th>
            <th className="pb-2 pr-3 font-medium">Caps</th>
            <th className="pb-2 pr-3 font-medium">Liquidity</th>
            <th className="pb-2 pr-3 font-medium">Rate</th>
            <th className="pb-2 font-medium">Force Penalty</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-slate-100 dark:border-slate-800/80">
            <td className="py-2 pr-3 font-medium">Idle</td>
            <td className="py-2 pr-3 tabular-nums">
              {formatToken(idleAssets, chainDecimals, displayDecimals, assetSymbol)} /{' '}
              {pctOfTotal(idleAssetsUsd ?? 0, totalUsd)}
            </td>
            <td className="py-2 pr-3">Infinite / 100%</td>
            <td className="py-2 pr-3 tabular-nums">
              {formatToken(idleAssets, chainDecimals, displayDecimals, assetSymbol)}
            </td>
            <td className="py-2">—</td>
            <td className="py-2">—</td>
          </tr>
          {adapters.map((adapter) => {
            const risk = riskByAdapter.get(adapter.address.toLowerCase());
            const cap = capByAdapter.get(adapter.address.toLowerCase());
            const label =
              adapter.metaMorpho?.name ??
              adapter.metaMorpho?.symbol ??
              (adapter.type.includes('MetaMorpho') ? 'MetaMorpho' : 'Market Adapter');
            const rate = resolveAdapterRate(risk);
            return (
              <tr key={adapter.address} className="border-b border-slate-100 dark:border-slate-800/80">
                <td className="py-2 pr-3">
                  <div className="font-medium">{label}</div>
                  {adapter.address.toLowerCase() === liquidityAdapterAddress && (
                    <Badge className="mt-1 bg-emerald-600 text-[10px] text-white">Liquidity</Badge>
                  )}
                </td>
                <td className="py-2 pr-3 tabular-nums">
                  {formatTokenFromAssets(adapter.assets, chainDecimals, displayDecimals, assetSymbol)} /{' '}
                  {pctOfTotal(adapter.assetsUsd ?? 0, totalUsd)}
                </td>
                <td className="py-2 pr-3 tabular-nums">
                  {cap
                    ? `${formatCapTokenAmount(cap.absolute, assetSymbol, assetDecimals)} / ${formatCapRelative(cap.relative)}`
                    : '—'}
                </td>
                <td className="py-2 pr-3 tabular-nums">{resolveAdapterLiquidity(risk, adapter)}</td>
                <td className="py-2 pr-3 tabular-nums">{rate != null ? formatPercentage(rate * 100, 2) : '—'}</td>
                <td className="py-2 tabular-nums">
                  {formatForceDeallocatePenaltyWad(adapter.forceDeallocatePenalty)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="mt-0.5 font-medium tabular-nums text-slate-900 dark:text-slate-100">{value}</dd>
    </div>
  );
}

function formatToken(
  raw: string | null,
  decimals: number,
  displayDecimals: number,
  symbol?: string | null
): string {
  if (!raw) return symbol ? `0 ${symbol}` : '0';
  try {
    const f = formatRawTokenAmount(BigInt(raw), decimals, displayDecimals);
    return symbol ? `${f} ${symbol}` : f;
  } catch {
    return '—';
  }
}

function formatTokenFromAssets(
  assets: number | null,
  decimals: number,
  displayDecimals: number,
  symbol?: string | null
): string {
  if (assets == null) return '—';
  try {
    const f = formatRawTokenAmount(BigInt(Math.floor(assets)), decimals, displayDecimals);
    return symbol ? `${f} ${symbol}` : f;
  } catch {
    return '—';
  }
}

function resolveAdapterRate(risk?: V2AdapterRiskData): number | null {
  if (!risk) return null;
  if (risk.underlyingVaultStats?.netApy != null) {
    return risk.underlyingVaultStats.netApy;
  }
  let bestUsd = 0;
  let bestApy: number | null = null;
  for (const m of risk.markets ?? []) {
    const apy = m.market?.state?.supplyApy;
    const usd = m.allocationUsd ?? 0;
    if (apy != null && usd >= bestUsd) {
      bestUsd = usd;
      bestApy = apy;
    }
  }
  return bestApy;
}

function resolveAdapterLiquidity(risk: V2AdapterRiskData | undefined, adapter: AdapterInfo): string {
  if (risk?.underlyingVaultStats?.liquidityUnderlying) {
    return risk.underlyingVaultStats.liquidityUsd != null
      ? formatUSD(risk.underlyingVaultStats.liquidityUsd, 2)
      : '—';
  }
  const usd = adapter.assetsUsd ?? 0;
  return formatUSD(usd, 2);
}
