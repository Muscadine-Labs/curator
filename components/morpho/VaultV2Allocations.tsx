'use client';

import { useMemo, useState, useCallback } from 'react';
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
import { ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useVaultV2Risk } from '@/lib/hooks/useVaultV2Risk';
import { useVaultWrite } from '@/lib/hooks/useVaultWrite';
import { TransactionButton } from '@/components/TransactionButton';
import { v2WriteConfigs } from '@/lib/onchain/vault-writes';
import type { Address, Hex } from 'viem';
import { parseUnits } from 'viem';
import { formatCompactUSD, formatPercentage, formatLtv, formatTokenAmount } from '@/lib/format/number';
import type { V2VaultRiskResponse } from '@/app/api/vaults/v2/[id]/risk/route';

interface VaultV2AllocationsProps {
  vaultAddress: string;
  preloadedData?: unknown;
  preloadedRisk?: V2VaultRiskResponse | null;
}

function formatOrDash(value: number | null | undefined): string {
  return value != null && Number.isFinite(value) ? formatPercentage(value, 2) : '—';
}

function scalePercent(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return value * 100;
}

type AdapterRow = {
  isAdapterRow: true;
  market: string;
  adapterAddress?: string;
  isIdle: boolean;
  allocated: number;
  pct: number;
  supplyApy: number | null;
  liquidity: number | null;
  allocationAssets: string | null;
  allocationTokenDecimals: number;
  allocationTokenSymbol: string | null;
};
type MarketRow = {
  isAdapterRow?: false;
  market: string;
  lltv: string | number | null;
  allocationAssets: string | null;
  allocationTokenDecimals: number;
  allocationTokenSymbol: string | null;
  utilization: number | null;
  liquidity: number | null;
  borrowApy: number | null;
  supplyApy: number | null;
  allocated: number;
  pct: number;
};
type RowType = AdapterRow | MarketRow;

function isAdapter(r: RowType): r is AdapterRow {
  return 'isAdapterRow' in r && r.isAdapterRow === true;
}

type InputMode = 'tokens' | 'percentage';

interface AllocEntry {
  adapterAddress: string;
  adapterLabel: string;
  currentAssets: string;
  currentUsd: number;
  newValue: string;
}

export function VaultV2Allocations({ vaultAddress, preloadedRisk }: VaultV2AllocationsProps) {
  const { data: fetchedRisk, isLoading, error } = useVaultV2Risk(vaultAddress);
  const risk = preloadedRisk ?? fetchedRisk;

  const { rows, total, adapterEntries, totalRawAssets, vaultDecimals, vaultSymbol } = useMemo(() => {
    if (!risk?.adapters) return { rows: [] as RowType[], total: 0, adapterEntries: [] as AllocEntry[], totalRawAssets: BigInt(0), vaultDecimals: 18, vaultSymbol: '' };

    const totalUsd = risk.totalAdapterAssetsUsd ?? 0;
    const vaultAsset = risk.vaultAsset ?? null;
    const dec = vaultAsset?.decimals ?? 18;
    const sym = vaultAsset?.symbol ?? '';
    const adapterList = (risk.adapters ?? []).slice().sort((a, b) => (b.allocationUsd ?? 0) - (a.allocationUsd ?? 0));

    const rows: RowType[] = [];
    const adapterEntries: AllocEntry[] = [];
    let totalRaw = BigInt(0);

    for (const adapter of adapterList) {
      const markets = adapter.markets ?? [];
      const isIdleAdapter = markets.length === 0;
      const adapterPct = totalUsd > 0 ? ((adapter.allocationUsd ?? 0) / totalUsd) * 100 : 0;

      let adapterSupplyApy: number | null = null;
      let adapterLiquidity: number | null = null;
      if (markets.length > 0) {
        const totalAlloc = markets.reduce((s, m) => s + (m.allocationUsd ?? 0), 0);
        if (totalAlloc > 0) {
          adapterSupplyApy = markets.reduce((s, m) => s + ((m.market?.state?.supplyApy ?? 0) * (m.allocationUsd ?? 0)), 0) / totalAlloc;
        }
        const sumLiq = markets.reduce((s, m) => s + (m.market?.state?.liquidityAssetsUsd ?? 0), 0);
        if (Number.isFinite(sumLiq)) adapterLiquidity = sumLiq;
      }

      const allocAssets = adapter.allocationAssets ?? null;
      const allocDecimals = markets[0]?.market?.loanAsset?.decimals ?? dec;
      const allocSymbol = markets[0]?.market?.loanAsset?.symbol ?? sym;

      rows.push({
        isAdapterRow: true,
        market: adapter.adapterLabel || 'Adapter',
        adapterAddress: adapter.adapterAddress,
        isIdle: isIdleAdapter,
        allocated: adapter.allocationUsd ?? 0,
        pct: adapterPct,
        supplyApy: adapterSupplyApy,
        liquidity: adapterLiquidity,
        allocationAssets: allocAssets,
        allocationTokenDecimals: allocDecimals,
        allocationTokenSymbol: allocSymbol,
      });

      if (adapter.adapterAddress && allocAssets) {
        try { totalRaw += BigInt(allocAssets); } catch { /* ignore */ }
        adapterEntries.push({
          adapterAddress: adapter.adapterAddress,
          adapterLabel: adapter.adapterLabel || 'Adapter',
          currentAssets: allocAssets,
          currentUsd: adapter.allocationUsd ?? 0,
          newValue: '',
        });
      }

      const sortedMarkets = markets.slice().sort((a, b) => (b.allocationUsd ?? 0) - (a.allocationUsd ?? 0));
      for (const m of sortedMarkets) {
        const col = m.market?.collateralAsset?.symbol;
        const loan = m.market?.loanAsset?.symbol;
        rows.push({
          market: col && loan ? `${col}/${loan}` : loan || col || adapter.adapterLabel || 'Market',
          lltv: m.market?.lltv ?? null,
          allocationAssets: m.allocationAssets ?? null,
          allocationTokenDecimals: m.market?.loanAsset?.decimals ?? 18,
          allocationTokenSymbol: m.market?.loanAsset?.symbol ?? null,
          utilization: m.market?.state?.utilization ?? null,
          liquidity: m.market?.state?.liquidityAssetsUsd ?? null,
          borrowApy: m.market?.state?.borrowApy ?? null,
          supplyApy: m.market?.state?.supplyApy ?? null,
          allocated: m.allocationUsd ?? 0,
          pct: totalUsd > 0 ? ((m.allocationUsd ?? 0) / totalUsd) * 100 : 0,
        });
      }
    }

    return { rows, total: totalUsd, adapterEntries, totalRawAssets: totalRaw, vaultDecimals: dec, vaultSymbol: sym };
  }, [risk]);

  const [showManage, setShowManage] = useState(false);
  const [inputMode, setInputMode] = useState<InputMode>('tokens');
  const [allocEntries, setAllocEntries] = useState<AllocEntry[]>([]);
  const allocateWrite = useVaultWrite();
  const deallocateWrite = useVaultWrite();

  // Seed entries when data loads
  useMemo(() => {
    if (adapterEntries.length > 0 && allocEntries.length === 0) {
      setAllocEntries(adapterEntries.map((e) => ({ ...e })));
    }
  }, [adapterEntries, allocEntries.length]);

  const updateAllocEntry = useCallback((addr: string, val: string) => {
    setAllocEntries((prev) => prev.map((e) => e.adapterAddress === addr ? { ...e, newValue: val } : e));
  }, []);

  // Validation for the rebalance view
  const rebalanceValidation = useMemo(() => {
    const modified = allocEntries.filter((e) => e.newValue.trim() !== '');
    if (modified.length === 0) return { valid: false, error: null };

    let totalNew = BigInt(0);
    for (const e of allocEntries) {
      if (e.newValue.trim() === '') {
        try { totalNew += BigInt(e.currentAssets); } catch { /* skip */ }
        continue;
      }
      if (inputMode === 'percentage') {
        const pct = parseFloat(e.newValue);
        if (isNaN(pct) || pct < 0 || pct > 100) return { valid: false, error: `Invalid percentage for ${e.adapterLabel}` };
        totalNew += totalRawAssets * BigInt(Math.round(pct * 1e6)) / BigInt(1e8);
      } else {
        try {
          const assets = parseUnits(e.newValue, vaultDecimals);
          if (assets < BigInt(0)) return { valid: false, error: `Negative amount for ${e.adapterLabel}` };
          totalNew += assets;
        } catch {
          return { valid: false, error: `Invalid number for ${e.adapterLabel}` };
        }
      }
    }

    if (totalNew !== totalRawAssets) {
      const diff = totalNew > totalRawAssets
        ? `+${formatTokenAmount(totalNew - totalRawAssets, vaultDecimals, 4)}`
        : `-${formatTokenAmount(totalRawAssets - totalNew, vaultDecimals, 4)}`;
      return {
        valid: false,
        error: `Total differs by ${diff} ${vaultSymbol}. Allocations must sum to ${formatTokenAmount(totalRawAssets, vaultDecimals, 2)} ${vaultSymbol}.`,
      };
    }

    return { valid: true, error: null };
  }, [allocEntries, inputMode, totalRawAssets, vaultDecimals, vaultSymbol]);

  const handleRebalance = useCallback(() => {
    // For each adapter where newValue > current -> allocate the difference
    // For each adapter where newValue < current -> deallocate the difference
    // We execute one at a time (allocate first adapter that changed)
    for (const e of allocEntries) {
      if (e.newValue.trim() === '') continue;
      let newAssets: bigint;
      if (inputMode === 'percentage') {
        const pct = parseFloat(e.newValue);
        newAssets = totalRawAssets * BigInt(Math.round(pct * 1e6)) / BigInt(1e8);
      } else {
        newAssets = parseUnits(e.newValue, vaultDecimals);
      }

      let currentAssets: bigint;
      try { currentAssets = BigInt(e.currentAssets); } catch { continue; }

      if (newAssets > currentAssets) {
        const diff = newAssets - currentAssets;
        allocateWrite.write(v2WriteConfigs.allocate(vaultAddress as Address, e.adapterAddress as Address, '0x' as Hex, diff));
        return;
      } else if (newAssets < currentAssets) {
        const diff = currentAssets - newAssets;
        deallocateWrite.write(v2WriteConfigs.deallocate(vaultAddress as Address, e.adapterAddress as Address, '0x' as Hex, diff));
        return;
      }
    }
  }, [allocEntries, inputMode, totalRawAssets, vaultDecimals, vaultAddress, allocateWrite, deallocateWrite]);

  if (!preloadedRisk && isLoading) {
    return (
      <Card>
        <CardHeader><CardTitle>Allocations</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error || !risk) {
    return (
      <Card>
        <CardHeader><CardTitle>Allocations</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-red-600 dark:text-red-400">
            Failed to load allocations: {error instanceof Error ? error.message : 'Unknown error'}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (rows.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle>Allocations</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-slate-500 dark:text-slate-400">No allocations yet.</p>
        </CardContent>
      </Card>
    );
  }

  const anyWriteLoading = allocateWrite.isLoading || deallocateWrite.isLoading;
  const anyWriteSuccess = allocateWrite.isSuccess || deallocateWrite.isSuccess;
  const anyWriteError = allocateWrite.error || deallocateWrite.error;
  const anyWriteHash = allocateWrite.txHash || deallocateWrite.txHash;

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Allocations</CardTitle>
          <CardDescription>
            Total: {formatCompactUSD(total)} ({formatTokenAmount(totalRawAssets, vaultDecimals, 2)} {vaultSymbol})
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
              {rows.map((r, i) =>
                isAdapter(r) ? (
                  <TableRow key={`adapter-${r.market}-${i}`} className="bg-muted/50">
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold">{r.market}</span>
                          {r.isIdle && <Badge variant="outline" className="text-xs">Idle</Badge>}
                        </div>
                        <span className="text-muted-foreground text-xs">{r.isIdle ? 'Idle' : 'Adapter'}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">—</TableCell>
                    <TableCell className="text-right">
                      {r.liquidity != null && Number.isFinite(r.liquidity) ? formatCompactUSD(r.liquidity) : '—'}
                    </TableCell>
                    <TableCell className="text-right">—</TableCell>
                    <TableCell className="text-right">{formatOrDash(scalePercent(r.supplyApy))}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-col items-end gap-0.5">
                        <span>
                          {r.allocationAssets != null
                            ? `${formatTokenAmount(BigInt(r.allocationAssets), r.allocationTokenDecimals, 2)} ${r.allocationTokenSymbol ?? ''}`.trim()
                            : '—'}
                        </span>
                        <span className="text-muted-foreground text-xs">{formatCompactUSD(r.allocated)}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">{`${r.pct.toFixed(2)}%`}</TableCell>
                  </TableRow>
                ) : (
                  <TableRow key={`${r.market}-${i}`}>
                    <TableCell className="pl-8">
                      <div className="flex flex-col gap-0.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{r.market}</span>
                          {formatLtv(r.lltv) === '—' && <Badge variant="outline" className="text-xs">Idle</Badge>}
                        </div>
                        <span className="text-muted-foreground text-xs">
                          {formatLtv(r.lltv) === '—' ? 'Idle' : `LTV ${formatLtv(r.lltv)}`}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">{formatOrDash(scalePercent(r.utilization))}</TableCell>
                    <TableCell className="text-right">
                      {r.liquidity != null && Number.isFinite(r.liquidity) ? formatCompactUSD(r.liquidity) : '—'}
                    </TableCell>
                    <TableCell className="text-right">{formatOrDash(scalePercent(r.borrowApy))}</TableCell>
                    <TableCell className="text-right">{formatOrDash(scalePercent(r.supplyApy))}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-col items-end gap-0.5">
                        <span>
                          {r.allocationAssets != null
                            ? `${formatTokenAmount(BigInt(r.allocationAssets), r.allocationTokenDecimals, 2)} ${r.allocationTokenSymbol ?? ''}`.trim()
                            : '—'}
                        </span>
                        <span className="text-muted-foreground text-xs">{formatCompactUSD(r.allocated)}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">{`${r.pct.toFixed(2)}%`}</TableCell>
                  </TableRow>
                )
              )}
            </TableBody>
          </Table>
        </div>

        {/* Manage Allocations */}
        <div className="mt-6 border-t pt-4">
          <button
            onClick={() => setShowManage(!showManage)}
            className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100"
          >
            {showManage ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            Manage Allocations
          </button>

          {showManage && (
            <div className="mt-4 space-y-4">
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold">Rebalance Adapters</h4>
                  <div className="flex gap-1 rounded-md border p-0.5">
                    <button
                      onClick={() => { setInputMode('tokens'); setAllocEntries((prev) => prev.map((e) => ({ ...e, newValue: '' }))); }}
                      className={`px-3 py-1 rounded text-xs font-medium transition-colors ${inputMode === 'tokens' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                    >
                      Tokens
                    </button>
                    <button
                      onClick={() => { setInputMode('percentage'); setAllocEntries((prev) => prev.map((e) => ({ ...e, newValue: '' }))); }}
                      className={`px-3 py-1 rounded text-xs font-medium transition-colors ${inputMode === 'percentage' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                    >
                      Percentage
                    </button>
                  </div>
                </div>

                <p className="text-xs text-muted-foreground">
                  {inputMode === 'tokens'
                    ? `Set new token amounts per adapter. Total must equal ${formatTokenAmount(totalRawAssets, vaultDecimals, 2)} ${vaultSymbol}. Leave blank to keep current.`
                    : 'Set new % per adapter. Total must equal 100%. Leave blank to keep current.'}
                </p>

                <div className="space-y-2">
                  {allocEntries.map((entry) => {
                    let currentBig: bigint;
                    try { currentBig = BigInt(entry.currentAssets); } catch { currentBig = BigInt(0); }
                    const currentPct = totalRawAssets > BigInt(0)
                      ? (Number(currentBig * BigInt(10000) / totalRawAssets) / 100)
                      : 0;
                    return (
                      <div key={entry.adapterAddress} className="flex items-center gap-3 rounded-md border border-slate-100 dark:border-slate-800 p-2">
                        <div className="flex-1 min-w-0">
                          <span className="text-sm font-medium truncate block">{entry.adapterLabel}</span>
                          <span className="text-xs text-muted-foreground">
                            Current: {formatTokenAmount(currentBig, vaultDecimals, 2)} {vaultSymbol} ({currentPct.toFixed(2)}%)
                          </span>
                        </div>
                        <div className="w-40">
                          <Input
                            type="text"
                            placeholder={inputMode === 'tokens' ? formatTokenAmount(currentBig, vaultDecimals, 4) : currentPct.toFixed(2)}
                            value={entry.newValue}
                            onChange={(e) => updateAllocEntry(entry.adapterAddress, e.target.value)}
                            className="text-right text-sm"
                          />
                        </div>
                        <span className="text-xs text-muted-foreground w-8">
                          {inputMode === 'percentage' ? '%' : vaultSymbol}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {rebalanceValidation.error && (
                  <div className="flex items-start gap-2 rounded-md bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 p-3">
                    <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
                    <p className="text-xs text-red-700 dark:text-red-300">{rebalanceValidation.error}</p>
                  </div>
                )}

                {rebalanceValidation.valid && (
                  <div className="rounded-md bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 p-3">
                    <p className="text-xs text-green-700 dark:text-green-300">Allocation is balanced. Ready to submit.</p>
                  </div>
                )}

                <TransactionButton
                  label="Rebalance"
                  onClick={handleRebalance}
                  disabled={!rebalanceValidation.valid}
                  isLoading={anyWriteLoading}
                  isSuccess={anyWriteSuccess}
                  error={anyWriteError}
                  txHash={anyWriteHash}
                />
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
