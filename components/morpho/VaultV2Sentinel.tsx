'use client';

import { useCallback, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { TransactionButton } from '@/components/TransactionButton';
import { formatLltvPill, formatMarketPairLabel } from '@/components/morpho/AllocationListView';
import { useVaultV2Governance } from '@/lib/hooks/useVaultV2Governance';
import { useVaultV2Risk } from '@/lib/hooks/useVaultV2Risk';
import { useVaultWrite } from '@/lib/hooks/useVaultWrite';
import { v2WriteConfigs } from '@/lib/onchain/vault-writes';
import {
  buildAdapterLabelMap,
  capDisplayLabel,
  capRowKey,
  formatCapRelative,
  formatCapTokenAmount,
  groupCaps,
} from '@/lib/morpho/v2-cap-format';
import { encodeMarketIdData, resolveCapIdData } from '@/lib/morpho/v2-id-data';
import { formatPercentage, formatRawTokenAmount, formatUSD } from '@/lib/format/number';
import {
  getTokenDisplayDecimals,
  resolveAssetDecimals,
} from '@/lib/format/asset-decimals';
import { marketKeyFromGraphQL } from '@/lib/morpho/morpho-app-links';
import type { CapInfo, VaultV2GovernanceResponse } from '@/app/api/vaults/v2/[id]/governance/route';
import type { V2VaultRiskResponse } from '@/app/api/vaults/v2/[id]/risk/route';
import type { Address, Hex } from 'viem';
import { parseUnits } from 'viem';

interface VaultV2SentinelProps {
  vaultAddress: string;
  preloadedGovernance?: VaultV2GovernanceResponse | null;
  preloadedRisk?: V2VaultRiskResponse | null;
  assetSymbol?: string | null;
  assetDecimals?: number | null;
}

type DeallocateRow = {
  key: string;
  label: string;
  lltv: string | null;
  adapterAddress: string;
  idData: Hex;
  currentRaw: bigint;
  currentUsd: number;
  allocationPct: number;
  supplyApy: number | null;
  liquidityUsd: number | null;
  absoluteCap: string | null;
  relativeCap: string | null;
};

export function VaultV2Sentinel({
  vaultAddress,
  preloadedGovernance,
  preloadedRisk,
  assetSymbol,
  assetDecimals,
}: VaultV2SentinelProps) {
  const { data: fetchedGov, isLoading: govLoading } = useVaultV2Governance(vaultAddress);
  const { data: fetchedRisk, isLoading: riskLoading } = useVaultV2Risk(vaultAddress);
  const governance = preloadedGovernance ?? fetchedGov;
  const risk = preloadedRisk ?? fetchedRisk;

  const chainDecimals = resolveAssetDecimals(assetSymbol ?? undefined, assetDecimals ?? undefined);
  const displayDecimals = getTokenDisplayDecimals(assetSymbol ?? undefined, chainDecimals);

  const totalUsd = useMemo(() => {
    const idle = risk?.idleAssetsUsd ?? governance?.idleAssetsUsd ?? 0;
    const strat = risk?.totalAdapterAssetsUsd ?? 0;
    return idle + strat;
  }, [risk, governance]);

  const deallocateRows = useMemo(() => buildDeallocateRows(risk, governance, totalUsd), [risk, governance, totalUsd]);

  if ((!preloadedGovernance && govLoading) || (!preloadedRisk && riskLoading)) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Sentinel</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-48 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!governance || !risk) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Sentinel</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-red-600 dark:text-red-400">Failed to load sentinel data.</p>
        </CardContent>
      </Card>
    );
  }

  const adapterLabels = buildAdapterLabelMap(governance.adapters);
  const grouped = groupCaps(governance.caps);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Allocation Overview</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-500 dark:text-slate-400">Total Assets</p>
          <p className="text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">
            {formatUSD(totalUsd, 2)}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {(risk.idleAssetsUsd ?? 0) > 0 && (
              <Badge variant="outline">
                Idle {formatUSD(risk.idleAssetsUsd ?? 0, 2)}
              </Badge>
            )}
            {deallocateRows
              .filter((r) => r.currentUsd > 0)
              .map((r) => (
                <Badge key={r.key} variant="secondary">
                  {r.label} {formatUSD(r.currentUsd, 2)} ({r.allocationPct.toFixed(1)}%)
                </Badge>
              ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Decrease Caps</CardTitle>
          <CardDescription>
            Sentinels can decrease absolute and relative caps without a timelock. Enter a new cap
            value below the current cap.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-8">
          <DecreaseCapSection
            title="Adapter Caps"
            caps={grouped.adapter}
            risk={risk}
            adapterLabels={adapterLabels}
            vaultAddress={vaultAddress}
            assetSymbol={assetSymbol}
            assetDecimals={assetDecimals}
          />
          <DecreaseCapSection
            title="Collateral Token Caps"
            caps={grouped.collateral}
            risk={risk}
            adapterLabels={adapterLabels}
            vaultAddress={vaultAddress}
            assetSymbol={assetSymbol}
            assetDecimals={assetDecimals}
          />
          <DecreaseCapSection
            title="Market Caps"
            caps={grouped.market}
            risk={risk}
            adapterLabels={adapterLabels}
            vaultAddress={vaultAddress}
            assetSymbol={assetSymbol}
            assetDecimals={assetDecimals}
            showLltv
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Deallocate to Idle</CardTitle>
          <CardDescription>
            Move assets from strategy positions back to vault idle cash. Partial deallocations are
            supported.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {deallocateRows.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">No strategy positions.</p>
          ) : (
            deallocateRows.map((row) => (
              <DeallocateRowForm
                key={row.key}
                row={row}
                vaultAddress={vaultAddress}
                assetSymbol={assetSymbol}
                assetDecimals={assetDecimals}
                chainDecimals={chainDecimals}
                displayDecimals={displayDecimals}
              />
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function DecreaseCapSection({
  title,
  caps,
  risk,
  adapterLabels,
  vaultAddress,
  assetSymbol,
  assetDecimals,
  showLltv,
}: {
  title: string;
  caps: CapInfo[];
  risk: V2VaultRiskResponse;
  adapterLabels: Map<string, string>;
  vaultAddress: string;
  assetSymbol?: string | null;
  assetDecimals?: number | null;
  showLltv?: boolean;
}) {
  if (caps.length === 0) return null;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
      <div className="space-y-3">
        {caps.map((cap, idx) => (
          <DecreaseCapRow
            key={capRowKey(cap, idx)}
            cap={cap}
            label={capDisplayLabel(cap, risk, adapterLabels)}
            lltv={
              showLltv && cap.marketKey
                ? resolveLltv(cap.marketKey, risk)
                : null
            }
            idData={resolveCapIdData(cap, risk)}
            vaultAddress={vaultAddress}
            assetSymbol={assetSymbol}
            assetDecimals={assetDecimals}
          />
        ))}
      </div>
    </div>
  );
}

function resolveLltv(marketKey: string, risk: V2VaultRiskResponse): string | null {
  const needle = marketKey.toLowerCase();
  for (const adapter of risk.adapters ?? []) {
    for (const m of adapter.markets ?? []) {
      const key = marketKeyFromGraphQL(m.market);
      if (key?.toLowerCase() === needle) {
        return formatLltvPill(m.market?.lltv ?? null);
      }
    }
  }
  return null;
}

function DecreaseCapRow({
  cap,
  label,
  lltv,
  idData,
  vaultAddress,
  assetSymbol,
  assetDecimals,
}: {
  cap: CapInfo;
  label: string;
  lltv: string | null;
  idData: Hex | null;
  vaultAddress: string;
  assetSymbol?: string | null;
  assetDecimals?: number | null;
}) {
  const [newAbsolute, setNewAbsolute] = useState('');
  const [newRelativePct, setNewRelativePct] = useState('');
  const absWrite = useVaultWrite();
  const relWrite = useVaultWrite();
  const chainDecimals = resolveAssetDecimals(assetSymbol ?? undefined, assetDecimals ?? undefined);

  const submitAbsolute = useCallback(() => {
    if (!idData || !newAbsolute.trim()) return;
    try {
      const parsed = parseUnits(newAbsolute.trim(), chainDecimals);
      absWrite.write(
        v2WriteConfigs.decreaseAbsoluteCap(vaultAddress as Address, idData, parsed)
      );
    } catch {
      /* invalid input */
    }
  }, [absWrite, chainDecimals, idData, newAbsolute, vaultAddress]);

  const submitRelative = useCallback(() => {
    if (!idData || !newRelativePct.trim()) return;
    try {
      const pct = Number(newRelativePct);
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) return;
      const wad = BigInt(Math.round(pct * 1e16));
      relWrite.write(
        v2WriteConfigs.decreaseRelativeCap(vaultAddress as Address, idData, wad)
      );
    } catch {
      /* invalid */
    }
  }, [idData, newRelativePct, relWrite, vaultAddress]);

  return (
    <div className="rounded-md border border-slate-200 p-3 dark:border-slate-800">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-slate-900 dark:text-slate-100">{label}</span>
        {lltv && <Badge variant="outline" className="text-xs">{lltv}</Badge>}
      </div>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
        Current: {formatCapTokenAmount(cap.allocation, assetSymbol, assetDecimals)} allocated ·{' '}
        {formatCapTokenAmount(cap.absoluteCap, assetSymbol, assetDecimals)} absolute ·{' '}
        {formatCapRelative(cap.relativeCap)} relative
      </p>
      {!idData ? (
        <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
          Cannot resolve cap idData for writes on this row.
        </p>
      ) : (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[140px] flex-1">
              <label className="text-xs text-slate-500">New absolute cap ({assetSymbol ?? 'tokens'})</label>
              <Input
                type="text"
                placeholder="e.g. 1000"
                value={newAbsolute}
                onChange={(e) => setNewAbsolute(e.target.value)}
              />
            </div>
            <TransactionButton
              label="Decrease absolute"
              size="sm"
              suppressConnectPrompt
              onClick={submitAbsolute}
              disabled={!newAbsolute.trim()}
              isLoading={absWrite.isLoading}
              isSuccess={absWrite.isSuccess}
              error={absWrite.error}
              txHash={absWrite.txHash}
            />
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[100px] flex-1">
              <label className="text-xs text-slate-500">New relative cap (%)</label>
              <Input
                type="text"
                placeholder="e.g. 50"
                value={newRelativePct}
                onChange={(e) => setNewRelativePct(e.target.value)}
              />
            </div>
            <TransactionButton
              label="Decrease relative"
              size="sm"
              suppressConnectPrompt
              onClick={submitRelative}
              disabled={!newRelativePct.trim()}
              isLoading={relWrite.isLoading}
              isSuccess={relWrite.isSuccess}
              error={relWrite.error}
              txHash={relWrite.txHash}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function DeallocateRowForm({
  row,
  vaultAddress,
  assetSymbol,
  assetDecimals,
  chainDecimals,
  displayDecimals,
}: {
  row: DeallocateRow;
  vaultAddress: string;
  assetSymbol?: string | null;
  assetDecimals?: number | null;
  chainDecimals: number;
  displayDecimals: number;
}) {
  const [amount, setAmount] = useState('');
  const write = useVaultWrite();

  const maxLabel = formatRawTokenAmount(row.currentRaw, chainDecimals, displayDecimals);

  const handleDeallocate = useCallback(() => {
    if (!amount.trim() || row.currentRaw === 0n) return;
    try {
      const parsed = parseUnits(amount.trim(), chainDecimals);
      if (parsed <= 0n || parsed > row.currentRaw) return;
      write.write(
        v2WriteConfigs.deallocate(
          vaultAddress as Address,
          row.adapterAddress as Address,
          row.idData,
          parsed
        )
      );
    } catch {
      /* invalid */
    }
  }, [amount, chainDecimals, row, vaultAddress, write]);

  const handleMax = () => {
    setAmount(formatRawTokenAmount(row.currentRaw, chainDecimals, displayDecimals).replace(/,/g, ''));
  };

  return (
    <div className="grid grid-cols-1 gap-3 rounded-md border border-slate-200 p-3 text-sm dark:border-slate-800 lg:grid-cols-6 lg:items-center">
      <div className="lg:col-span-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{row.label}</span>
          {row.lltv && <Badge variant="outline" className="text-xs">{row.lltv}</Badge>}
        </div>
        <p className="mt-1 text-xs text-slate-500">
          {maxLabel} {assetSymbol ?? ''} · {row.allocationPct.toFixed(2)}% of vault
        </p>
      </div>
      <div className="text-xs text-slate-600 dark:text-slate-300">
        {row.absoluteCap && row.relativeCap ? (
          <>
            {formatCapTokenAmount(row.absoluteCap, assetSymbol, assetDecimals)} /{' '}
            {formatCapRelative(row.relativeCap)}
          </>
        ) : (
          '—'
        )}
      </div>
      <div className="tabular-nums">
        {row.supplyApy != null ? formatPercentage(row.supplyApy * 100, 2) : '—'}
      </div>
      <div className="tabular-nums text-xs">
        {row.liquidityUsd != null ? formatUSD(row.liquidityUsd, 2) : '—'}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="text"
          className="h-8 min-w-[100px] flex-1"
          placeholder={`Max ${maxLabel}`}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <Button type="button" size="sm" variant="outline" onClick={handleMax}>
          Max
        </Button>
        <TransactionButton
          label="Deallocate"
          size="sm"
          suppressConnectPrompt
          onClick={handleDeallocate}
          disabled={!amount.trim() || row.currentRaw === 0n}
          isLoading={write.isLoading}
          isSuccess={write.isSuccess}
          error={write.error}
          txHash={write.txHash}
        />
      </div>
    </div>
  );
}

function buildDeallocateRows(
  risk: V2VaultRiskResponse | null | undefined,
  governance: VaultV2GovernanceResponse | null | undefined,
  totalUsd: number
): DeallocateRow[] {
  if (!risk) return [];

  const capByMarket = new Map<string, CapInfo>();
  const capByAdapter = new Map<string, CapInfo>();
  for (const cap of governance?.caps ?? []) {
    if (cap.marketKey) capByMarket.set(cap.marketKey.toLowerCase(), cap);
    if (cap.adapterAddress && !cap.marketKey && !cap.collateralAddress) {
      capByAdapter.set(cap.adapterAddress.toLowerCase(), cap);
    }
  }

  const rows: DeallocateRow[] = [];

  for (const adapter of risk.adapters ?? []) {
    if (adapter.adapterType === 'MetaMorphoAdapter') {
      const raw = parseBig(adapter.allocationAssets);
      if (raw === 0n && (adapter.allocationUsd ?? 0) === 0) continue;
      const cap = capByAdapter.get(adapter.adapterAddress.toLowerCase());
      rows.push({
        key: `meta-${adapter.adapterAddress}`,
        label: adapter.adapterLabel || 'MetaMorpho',
        lltv: null,
        adapterAddress: adapter.adapterAddress,
        idData: '0x' as Hex,
        currentRaw: raw,
        currentUsd: adapter.allocationUsd ?? 0,
        allocationPct: totalUsd > 0 ? ((adapter.allocationUsd ?? 0) / totalUsd) * 100 : 0,
        supplyApy: adapter.underlyingVaultStats?.netApy ?? null,
        liquidityUsd: adapter.underlyingVaultStats?.liquidityUsd ?? null,
        absoluteCap: cap?.absoluteCap ?? null,
        relativeCap: cap?.relativeCap ?? null,
      });
      continue;
    }

    for (const m of adapter.markets ?? []) {
      const raw = parseBig(m.allocationAssets);
      const usd = m.allocationUsd ?? 0;
      const key = marketKeyFromGraphQL(m.market);
      const cap = key ? capByMarket.get(key.toLowerCase()) : undefined;
      const col = m.market?.collateralAsset?.symbol;
      const loan = m.market?.loanAsset?.symbol;

      rows.push({
        key: key ?? `${adapter.adapterAddress}-${col}-${loan}`,
        label: formatMarketPairLabel(col, loan),
        lltv: formatLltvPill(m.market?.lltv ?? null),
        adapterAddress: adapter.adapterAddress,
        idData: m.market ? encodeMarketIdData(m.market) : ('0x' as Hex),
        currentRaw: raw,
        currentUsd: usd,
        allocationPct: totalUsd > 0 ? (usd / totalUsd) * 100 : 0,
        supplyApy: m.market?.state?.supplyApy ?? null,
        liquidityUsd: m.market?.state?.liquidityAssetsUsd ?? null,
        absoluteCap: cap?.absoluteCap ?? null,
        relativeCap: cap?.relativeCap ?? null,
      });
    }
  }

  return rows.sort((a, b) => b.currentUsd - a.currentUsd);
}

function parseBig(value: string | null | undefined): bigint {
  if (!value) return 0n;
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}
