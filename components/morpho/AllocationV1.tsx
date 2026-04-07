'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useVault } from '@/lib/hooks/useProtocolStats';
import { formatCompactUSD, formatPercentage, formatLtv, formatTokenAmount } from '@/lib/format/number';
import { cn } from '@/lib/utils';
import { ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useVaultWrite } from '@/lib/hooks/useVaultWrite';
import { TransactionButton } from '@/components/TransactionButton';
import { v1WriteConfigs, type MarketAllocation, type MarketParams } from '@/lib/onchain/vault-writes';
import type { Address } from 'viem';
import { parseUnits } from 'viem';

interface AllocationV1Props {
  vaultAddress: string;
}

interface MarketAllocationInput {
  uniqueKey: string;
  marketName: string;
  loanAssetAddress?: string | null;
  loanAssetSymbol?: string | null;
  collateralAssetAddress?: string | null;
  collateralAssetSymbol?: string | null;
  oracleAddress?: string | null;
  irmAddress?: string | null;
  lltv?: number | null;
  currentAssets: bigint;
  currentAssetsUsd: number;
  isIdle: boolean;
  decimals: number;
  supplyApy?: number | null;
  borrowApy?: number | null;
  utilization?: number | null;
  liquidityAssetsUsd?: number | null;
}

type InputMode = 'tokens' | 'percentage';

interface ReallocEntry {
  marketKey: string;
  newValue: string;
}

export function AllocationV1({ vaultAddress }: AllocationV1Props) {
  const { data: vault, isLoading, error } = useVault(vaultAddress);
  const [allocations, setAllocations] = useState<Map<string, MarketAllocationInput>>(new Map());
  const [showManage, setShowManage] = useState(false);
  const [inputMode, setInputMode] = useState<InputMode>('tokens');
  const [entries, setEntries] = useState<ReallocEntry[]>([]);
  const vaultWrite = useVaultWrite();

  const totalAssetsUsd = useMemo(() => {
    return vault?.allocation?.reduce((sum, alloc) => sum + (alloc.supplyAssetsUsd ?? 0), 0) ?? 0;
  }, [vault?.allocation]);

  const totalRawAssets = useMemo(() => {
    let total = BigInt(0);
    allocations.forEach((a) => { total += a.currentAssets; });
    return total;
  }, [allocations]);

  const decimals = vault?.assetDecimals ?? 18;

  const assetSymbol = useMemo(() => {
    const first = allocations.values().next();
    return (first.done ? null : first.value?.loanAssetSymbol) ?? vault?.asset ?? '';
  }, [allocations, vault?.asset]);

  // Initialize allocations from vault data
  useEffect(() => {
    if (!vault?.allocation || allocations.size > 0) return;
    const dec = vault?.assetDecimals ?? 18;
    const init = new Map<string, MarketAllocationInput>();
    vault.allocation.forEach((alloc) => {
      if (!alloc.marketKey) return;
      let supplyAssets: bigint;
      if (typeof alloc.supplyAssets === 'string') {
        try { supplyAssets = BigInt(alloc.supplyAssets); } catch { supplyAssets = BigInt(0); }
      } else if (typeof alloc.supplyAssets === 'number') {
        supplyAssets = BigInt(Math.floor(alloc.supplyAssets));
      } else {
        supplyAssets = BigInt(0);
      }

      const col = alloc.collateralAssetSymbol;
      const loan = alloc.loanAssetSymbol;
      const name = col && loan ? `${col}/${loan}` : loan || col || 'Unknown Market';

      init.set(alloc.marketKey, {
        uniqueKey: alloc.marketKey,
        marketName: name,
        loanAssetAddress: alloc.loanAssetAddress ?? null,
        loanAssetSymbol: alloc.loanAssetSymbol ?? null,
        collateralAssetAddress: alloc.collateralAssetAddress ?? null,
        collateralAssetSymbol: alloc.collateralAssetSymbol ?? null,
        oracleAddress: alloc.oracleAddress ?? null,
        irmAddress: alloc.irmAddress ?? null,
        lltv: alloc.lltv ?? null,
        currentAssets: supplyAssets,
        currentAssetsUsd: alloc.supplyAssetsUsd ?? 0,
        isIdle: false,
        decimals: dec,
        supplyApy: alloc.supplyApy ?? null,
        borrowApy: alloc.borrowApy ?? null,
        utilization: alloc.utilization ?? null,
        liquidityAssetsUsd: alloc.liquidityAssetsUsd ?? null,
      });
    });
    setAllocations(init);
  }, [vault?.allocation, allocations.size, vault?.assetDecimals]);

  // Seed entries once allocations are loaded
  useEffect(() => {
    if (allocations.size > 0 && entries.length === 0) {
      const sorted = Array.from(allocations.values()).sort((a, b) => Number(b.currentAssets) - Number(a.currentAssets));
      setEntries(sorted.map((a) => ({ marketKey: a.uniqueKey, newValue: '' })));
    }
  }, [allocations, entries.length]);

  const updateEntry = useCallback((key: string, val: string) => {
    setEntries((prev) => prev.map((e) => e.marketKey === key ? { ...e, newValue: val } : e));
  }, []);

  // Compute proposed token amounts per market + total
  const proposed = useMemo(() => {
    const result: { key: string; assets: bigint; valid: boolean }[] = [];
    let total = BigInt(0);
    let anyModified = false;
    let parseError: string | null = null;

    for (const e of entries) {
      const alloc = allocations.get(e.marketKey);
      if (!alloc) continue;

      if (e.newValue.trim() === '') {
        result.push({ key: e.marketKey, assets: alloc.currentAssets, valid: true });
        total += alloc.currentAssets;
        continue;
      }

      anyModified = true;
      if (inputMode === 'percentage') {
        const pct = parseFloat(e.newValue);
        if (isNaN(pct) || pct < 0 || pct > 100) {
          parseError = `Invalid percentage for ${alloc.marketName}`;
          result.push({ key: e.marketKey, assets: BigInt(0), valid: false });
          continue;
        }
        // pct% of totalRawAssets, rounding down
        const assets = totalRawAssets * BigInt(Math.round(pct * 1e6)) / BigInt(1e8);
        result.push({ key: e.marketKey, assets, valid: true });
        total += assets;
      } else {
        try {
          const assets = parseUnits(e.newValue, decimals);
          if (assets < BigInt(0)) {
            parseError = `Negative amount for ${alloc.marketName}`;
            result.push({ key: e.marketKey, assets: BigInt(0), valid: false });
            continue;
          }
          result.push({ key: e.marketKey, assets, valid: true });
          total += assets;
        } catch {
          parseError = `Invalid number for ${alloc.marketName}`;
          result.push({ key: e.marketKey, assets: BigInt(0), valid: false });
        }
      }
    }

    return { items: result, total, anyModified, parseError };
  }, [entries, inputMode, allocations, totalRawAssets, decimals]);

  const validationError = useMemo(() => {
    if (proposed.parseError) return proposed.parseError;
    if (!proposed.anyModified) return null;
    if (proposed.total !== totalRawAssets) {
      const diff = proposed.total > totalRawAssets
        ? `+${formatTokenAmount(proposed.total - totalRawAssets, decimals, 4)}`
        : `-${formatTokenAmount(totalRawAssets - proposed.total, decimals, 4)}`;
      return `Total differs from vault assets by ${diff} ${assetSymbol}. Reallocate must preserve total (${formatTokenAmount(totalRawAssets, decimals, 2)} ${assetSymbol}).`;
    }
    return null;
  }, [proposed, totalRawAssets, decimals, assetSymbol]);

  const canSubmit = proposed.anyModified && !validationError;

  const handleReallocate = useCallback(() => {
    if (!canSubmit) return;
    const allocationsList: MarketAllocation[] = [];
    for (const p of proposed.items) {
      const alloc = allocations.get(p.key);
      if (!alloc) continue;
      allocationsList.push({
        marketParams: {
          loanToken: (alloc.loanAssetAddress || '0x0000000000000000000000000000000000000000') as Address,
          collateralToken: (alloc.collateralAssetAddress || '0x0000000000000000000000000000000000000000') as Address,
          oracle: (alloc.oracleAddress || '0x0000000000000000000000000000000000000000') as Address,
          irm: (alloc.irmAddress || '0x0000000000000000000000000000000000000000') as Address,
          lltv: BigInt(Math.floor((alloc.lltv ?? 0) * 1e18)),
        },
        assets: p.assets,
      });
    }
    vaultWrite.write(v1WriteConfigs.reallocate(vaultAddress as Address, allocationsList));
  }, [canSubmit, proposed, allocations, vaultAddress, vaultWrite]);

  if (isLoading) {
    return (
      <Card>
        <CardHeader><CardTitle>Allocation</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader><CardTitle>Allocation</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-red-600 dark:text-red-400">
            Failed to load allocation data: {error instanceof Error ? error.message : 'Unknown error'}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!vault || !vault.allocation || vault.allocation.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle>Allocation</CardTitle></CardHeader>
        <CardContent>
          <p className="text-center py-8 text-slate-500 dark:text-slate-400">No allocation data available</p>
        </CardContent>
      </Card>
    );
  }

  const sortedAllocations = Array.from(allocations.values()).sort((a, b) => {
    if (Number(b.currentAssets) !== Number(a.currentAssets)) return Number(b.currentAssets) - Number(a.currentAssets);
    if (a.isIdle && !b.isIdle) return 1;
    if (!a.isIdle && b.isIdle) return -1;
    return 0;
  });

  const fmt = (v: number | null | undefined) =>
    v != null && Number.isFinite(v) ? formatPercentage(v, 2) : '—';

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Allocation</CardTitle>
          <CardDescription>
            Total: {formatCompactUSD(totalAssetsUsd)} ({formatTokenAmount(totalRawAssets, decimals, 2)} {assetSymbol})
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Market</TableHead>
                <TableHead className="text-right">Utilization</TableHead>
                <TableHead className="text-right">Liquidity</TableHead>
                <TableHead className="text-right">Borrow APY</TableHead>
                <TableHead className="text-right">Supply APY</TableHead>
                <TableHead className="text-right">Allocated</TableHead>
                <TableHead className="text-right">% Allocated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedAllocations.map((alloc) => {
                const pct = totalAssetsUsd > 0 ? (alloc.currentAssetsUsd / totalAssetsUsd) * 100 : 0;
                return (
                  <TableRow key={alloc.uniqueKey} className={cn(alloc.isIdle && 'opacity-75')}>
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <a
                            href={`https://app.morpho.org/base/market/${alloc.uniqueKey}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium hover:text-blue-600 dark:hover:text-blue-400 underline decoration-1 underline-offset-2"
                          >
                            {alloc.marketName}
                          </a>
                          {(alloc.isIdle || formatLtv(alloc.lltv) === '—') && (
                            <Badge variant="outline" className="text-xs">Idle</Badge>
                          )}
                        </div>
                        <span className="text-muted-foreground text-xs">
                          {formatLtv(alloc.lltv) === '—' ? 'Idle' : `LTV ${formatLtv(alloc.lltv)}`}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">{fmt(alloc.utilization)}</TableCell>
                    <TableCell className="text-right">
                      {alloc.liquidityAssetsUsd != null && Number.isFinite(alloc.liquidityAssetsUsd)
                        ? formatCompactUSD(alloc.liquidityAssetsUsd)
                        : '—'}
                    </TableCell>
                    <TableCell className="text-right">{fmt(alloc.borrowApy)}</TableCell>
                    <TableCell className="text-right">{fmt(alloc.supplyApy)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-col items-end gap-0.5">
                        <span>
                          {formatTokenAmount(alloc.currentAssets, alloc.decimals, 2)} {alloc.loanAssetSymbol || ''}
                        </span>
                        <span className="text-muted-foreground text-xs">{formatCompactUSD(alloc.currentAssetsUsd)}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      {totalAssetsUsd > 0 ? `${pct.toFixed(2)}%` : '—'}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        {/* Manage Reallocation */}
        <div className="mt-6 border-t pt-4">
          <button
            onClick={() => setShowManage(!showManage)}
            className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100"
          >
            {showManage ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            Manage Allocation
          </button>

          {showManage && (
            <div className="mt-4 space-y-4">
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold">Reallocate</h4>
                  <div className="flex gap-1 rounded-md border p-0.5">
                    <button
                      onClick={() => { setInputMode('tokens'); setEntries((prev) => prev.map((e) => ({ ...e, newValue: '' }))); }}
                      className={`px-3 py-1 rounded text-xs font-medium transition-colors ${inputMode === 'tokens' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                    >
                      Tokens
                    </button>
                    <button
                      onClick={() => { setInputMode('percentage'); setEntries((prev) => prev.map((e) => ({ ...e, newValue: '' }))); }}
                      className={`px-3 py-1 rounded text-xs font-medium transition-colors ${inputMode === 'percentage' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                    >
                      Percentage
                    </button>
                  </div>
                </div>

                <p className="text-xs text-muted-foreground">
                  {inputMode === 'tokens'
                    ? `Set the new token amount per market. Total must equal ${formatTokenAmount(totalRawAssets, decimals, 2)} ${assetSymbol}. Leave blank to keep current.`
                    : 'Set the new % allocation per market. Total must equal 100%. Leave blank to keep current.'}
                </p>

                <div className="space-y-2">
                  {entries.map((entry) => {
                    const alloc = allocations.get(entry.marketKey);
                    if (!alloc) return null;
                    const currentPct = totalRawAssets > BigInt(0)
                      ? (Number(alloc.currentAssets * BigInt(10000) / totalRawAssets) / 100)
                      : 0;
                    return (
                      <div key={entry.marketKey} className="flex items-center gap-3 rounded-md border border-slate-100 dark:border-slate-800 p-2">
                        <div className="flex-1 min-w-0">
                          <span className="text-sm font-medium truncate block">{alloc.marketName}</span>
                          <span className="text-xs text-muted-foreground">
                            Current: {formatTokenAmount(alloc.currentAssets, decimals, 2)} {assetSymbol} ({currentPct.toFixed(2)}%)
                          </span>
                        </div>
                        <div className="w-40">
                          <Input
                            type="text"
                            placeholder={inputMode === 'tokens' ? formatTokenAmount(alloc.currentAssets, decimals, 4) : currentPct.toFixed(2)}
                            value={entry.newValue}
                            onChange={(e) => updateEntry(entry.marketKey, e.target.value)}
                            className="text-right text-sm"
                          />
                        </div>
                        <span className="text-xs text-muted-foreground w-8">
                          {inputMode === 'percentage' ? '%' : assetSymbol}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {validationError && (
                  <div className="flex items-start gap-2 rounded-md bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 p-3">
                    <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
                    <p className="text-xs text-red-700 dark:text-red-300">{validationError}</p>
                  </div>
                )}

                {canSubmit && (
                  <div className="rounded-md bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 p-3">
                    <p className="text-xs text-green-700 dark:text-green-300">Allocation is balanced. Ready to submit.</p>
                  </div>
                )}

                <TransactionButton
                  label="Reallocate"
                  onClick={handleReallocate}
                  disabled={!canSubmit}
                  isLoading={vaultWrite.isLoading}
                  isSuccess={vaultWrite.isSuccess}
                  error={vaultWrite.error}
                  txHash={vaultWrite.txHash}
                />
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
