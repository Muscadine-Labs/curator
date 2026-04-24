'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useVault } from '@/lib/hooks/useProtocolStats';
import {
  formatCompactUSD,
  formatPercentage,
  formatLtv,
  formatTokenAmount,
  formatRawTokenAmount,
} from '@/lib/format/number';
import { cn } from '@/lib/utils';
import { Pencil, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useVaultWrite } from '@/lib/hooks/useVaultWrite';
import { TransactionButton } from '@/components/TransactionButton';
import { v1WriteConfigs, type MarketAllocation } from '@/lib/onchain/vault-writes';
import type { Address } from 'viem';
import { parseUnits, maxUint256 } from 'viem';
import {
  AllocationFilters,
  DEFAULT_FILTER_STATE,
  type AllocationFilterState,
} from '@/components/morpho/AllocationFilters';

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
  lltvRaw?: string | null;
  currentAssets: bigint;
  currentAssetsUsd: number;
  isIdle: boolean;
  decimals: number;
  supplyApy?: number | null;
  borrowApy?: number | null;
  utilization?: number | null;
  liquidityAssetsUsd?: number | null;
  /** Raw supply cap in base units (token decimals). null = no cap / unknown. */
  supplyCapRaw: bigint | null;
}

type InputMode = 'tokens' | 'percentage';

interface ReallocEntry {
  marketKey: string;
  newValue: string;
}

/** Parse supplyCap (number | string) returned from the Morpho API as a raw bigint. */
function parseSupplyCap(raw: unknown): bigint | null {
  if (raw == null) return null;
  if (typeof raw === 'bigint') return raw;
  if (typeof raw === 'string') {
    try {
      return BigInt(raw.split('.')[0]);
    } catch {
      return null;
    }
  }
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw <= 0) return null;
    try {
      return BigInt(Math.floor(raw));
    } catch {
      return null;
    }
  }
  return null;
}

export function AllocationV1({ vaultAddress }: AllocationV1Props) {
  const { data: vault, isLoading, error } = useVault(vaultAddress);
  const [allocations, setAllocations] = useState<Map<string, MarketAllocationInput>>(new Map());
  const [editing, setEditing] = useState(false);
  const [inputMode, setInputMode] = useState<InputMode>('percentage');
  const [entries, setEntries] = useState<ReallocEntry[]>([]);
  const [filters, setFilters] = useState<AllocationFilterState>(DEFAULT_FILTER_STATE);
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
        lltvRaw: alloc.lltvRaw ?? null,
        currentAssets: supplyAssets,
        currentAssetsUsd: alloc.supplyAssetsUsd ?? 0,
        isIdle: false,
        decimals: dec,
        supplyApy: alloc.supplyApy ?? null,
        borrowApy: alloc.borrowApy ?? null,
        utilization: alloc.utilization ?? null,
        liquidityAssetsUsd: alloc.liquidityAssetsUsd ?? null,
        supplyCapRaw: parseSupplyCap(alloc.supplyCap),
      });
    });
    setAllocations(init);
  }, [vault?.allocation, allocations.size, vault?.assetDecimals]);

  const seedEntries = useCallback(() => {
    const sorted = Array.from(allocations.values()).sort((a, b) =>
      Number(b.currentAssets) - Number(a.currentAssets)
    );
    setEntries(sorted.map((a) => ({ marketKey: a.uniqueKey, newValue: '' })));
  }, [allocations]);

  const startEditing = useCallback(() => {
    seedEntries();
    setEditing(true);
  }, [seedEntries]);

  const cancelEditing = useCallback(() => {
    setEditing(false);
    vaultWrite.reset();
  }, [vaultWrite]);

  const updateEntry = useCallback((key: string, val: string) => {
    setEntries((prev) => prev.map((e) => e.marketKey === key ? { ...e, newValue: val } : e));
  }, []);

  /**
   * Resolve each entry to a target bigint, apply dust correction so the sum
   * exactly equals totalRawAssets, and validate per-market caps.
   */
  const resolvedAllocations = useMemo(() => {
    if (!editing || entries.length === 0) return null;

    const modified = entries.filter((e) => e.newValue.trim() !== '');
    if (modified.length === 0) return null;

    type Target = { key: string; assets: bigint; current: bigint };
    const targets: Target[] = [];
    let errorMsg: string | null = null;

    for (const e of entries) {
      const alloc = allocations.get(e.marketKey);
      if (!alloc) continue;

      if (e.newValue.trim() === '') {
        targets.push({ key: e.marketKey, assets: alloc.currentAssets, current: alloc.currentAssets });
        continue;
      }

      if (inputMode === 'percentage') {
        const pct = parseFloat(e.newValue);
        if (isNaN(pct) || pct < 0 || pct > 100) {
          errorMsg = `Invalid percentage for ${alloc.marketName}`;
          break;
        }
        const raw = totalRawAssets * BigInt(Math.round(pct * 1e10)) / BigInt(1e12);
        targets.push({ key: e.marketKey, assets: raw, current: alloc.currentAssets });
      } else {
        try {
          const raw = parseUnits(e.newValue, decimals);
          if (raw < BigInt(0)) {
            errorMsg = `Negative amount for ${alloc.marketName}`;
            break;
          }
          targets.push({ key: e.marketKey, assets: raw, current: alloc.currentAssets });
        } catch {
          errorMsg = `Invalid number for ${alloc.marketName}`;
          break;
        }
      }
    }

    if (errorMsg) return { valid: false as const, error: errorMsg, targets: [] as Target[], sumAssets: BigInt(0) };
    if (targets.length !== entries.length) {
      return { valid: false as const, error: 'Missing entries', targets: [] as Target[], sumAssets: BigInt(0) };
    }

    // Auto-adjust dust: push remainder onto the largest allocation.
    let sum = targets.reduce((s, t) => s + t.assets, BigInt(0));
    const diff = totalRawAssets - sum;
    if (diff !== BigInt(0) && targets.length > 0) {
      const largest = targets.reduce((best, t) => t.assets > best.assets ? t : best, targets[0]);
      largest.assets += diff;
      sum = totalRawAssets;
    }

    if (targets.some((t) => t.assets < BigInt(0))) {
      return { valid: false as const, error: 'Allocation would go negative after dust adjustment', targets: [] as Target[], sumAssets: BigInt(0) };
    }

    // Cap validation
    for (const t of targets) {
      if (t.assets <= t.current) continue;
      const alloc = allocations.get(t.key);
      if (!alloc?.supplyCapRaw) continue;
      if (t.assets > alloc.supplyCapRaw) {
        return {
          valid: false as const,
          error: `${alloc.marketName}: allocation exceeds supply cap (${formatRawTokenAmount(alloc.supplyCapRaw, alloc.decimals, 2)} ${alloc.loanAssetSymbol ?? ''})`,
          targets: [] as Target[],
          sumAssets: BigInt(0),
        };
      }
    }

    const anyChanged = targets.some((t) => t.assets !== t.current);
    if (!anyChanged) {
      return { valid: false as const, error: null, targets: [] as Target[], sumAssets: sum };
    }

    return { valid: true as const, error: null, targets, sumAssets: sum };
  }, [editing, entries, inputMode, allocations, totalRawAssets, decimals]);

  const handleReallocate = useCallback(() => {
    if (!resolvedAllocations?.valid) return;

    const toMarketAlloc = (t: { key: string; assets: bigint; current: bigint }, override?: bigint): MarketAllocation | null => {
      const alloc = allocations.get(t.key);
      if (!alloc) return null;
      const ZERO_ADDR = '0x0000000000000000000000000000000000000000' as Address;
      return {
        marketParams: {
          loanToken: (alloc.loanAssetAddress || ZERO_ADDR) as Address,
          collateralToken: (alloc.collateralAssetAddress || ZERO_ADDR) as Address,
          oracle: (alloc.oracleAddress || ZERO_ADDR) as Address,
          irm: (alloc.irmAddress || ZERO_ADDR) as Address,
          lltv: alloc.lltvRaw ? BigInt(alloc.lltvRaw) : BigInt(0),
        },
        assets: override ?? t.assets,
      };
    };

    // MetaMorpho V1 reallocate processes entries sequentially:
    // withdrawals (decreased allocations) come first to create idle balance,
    // then deposits (increased allocations) consume the idle balance.
    //
    // IMPORTANT: between fetching state and the tx landing, each market
    // accrues interest. On-chain, totalWithdrawn will therefore be slightly
    // larger than our client-side estimate. If we pass fixed supply targets
    // for every deposit, the contract's final check (totalSupplied ==
    // totalWithdrawn) will revert with InconsistentReallocation.
    //
    // The canonical fix is to mark the LAST deposit with assets =
    // type(uint256).max — the contract then interprets that entry as
    // "supply the residual (totalWithdrawn - totalSupplied)", making the
    // transaction resilient to interest accrual and rounding.

    const withdrawalTargets = resolvedAllocations.targets.filter((t) => t.assets < t.current);
    // Deposits: sorted ascending by delta so the LARGEST deposit is the catcher
    const depositTargets = resolvedAllocations.targets
      .filter((t) => t.assets > t.current)
      .sort((a, b) => {
        const da = a.assets - a.current;
        const db = b.assets - b.current;
        if (da === db) return 0;
        return da < db ? -1 : 1;
      });

    const withdrawals = withdrawalTargets
      .map((t) => toMarketAlloc(t))
      .filter((a): a is MarketAllocation => a !== null);

    const deposits: MarketAllocation[] = [];
    for (let i = 0; i < depositTargets.length; i++) {
      const isCatcher = i === depositTargets.length - 1 && withdrawalTargets.length > 0;
      const override = isCatcher ? maxUint256 : undefined;
      const alloc = toMarketAlloc(depositTargets[i], override);
      if (alloc) deposits.push(alloc);
    }

    const allocationsList = [...withdrawals, ...deposits];
    if (allocationsList.length === 0) return;
    vaultWrite.write(v1WriteConfigs.reallocate(vaultAddress as Address, allocationsList));
  }, [resolvedAllocations, allocations, vaultAddress, vaultWrite]);

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

  // --- Row building, filtering & sorting --------------------------------
  const rowsBase = Array.from(allocations.values());
  const entryByKey = new Map(entries.map((e) => [e.marketKey, e]));

  const search = filters.search.trim().toLowerCase();
  const filteredRows = rowsBase.filter((alloc) => {
    if (search) {
      const hay = `${alloc.marketName} ${alloc.loanAssetSymbol ?? ''} ${alloc.collateralAssetSymbol ?? ''}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    if (filters.hideZero && alloc.currentAssets === BigInt(0)) return false;
    const rowIsIdle = alloc.isIdle || formatLtv(alloc.lltv) === '—';
    if (filters.onlyIdle && !rowIsIdle) return false;
    if (filters.hideIdle && rowIsIdle) return false;
    if (filters.onlyWithCapacity) {
      const cap = alloc.supplyCapRaw;
      if (cap == null) return false;
      if (cap <= alloc.currentAssets) return false;
    }
    if (editing && filters.onlyEdited) {
      const entry = entryByKey.get(alloc.uniqueKey);
      if (!entry || entry.newValue.trim() === '') return false;
    }
    return true;
  });

  const sortedAllocations = [...filteredRows].sort((a, b) => {
    switch (filters.sort) {
      case 'allocated-asc':
        return Number(a.currentAssets) - Number(b.currentAssets);
      case 'supplyApy-desc':
        return (b.supplyApy ?? -Infinity) - (a.supplyApy ?? -Infinity);
      case 'utilization-desc':
        return (b.utilization ?? -Infinity) - (a.utilization ?? -Infinity);
      case 'capacity-desc': {
        const capA = a.supplyCapRaw != null ? Number(a.supplyCapRaw - a.currentAssets) : -Infinity;
        const capB = b.supplyCapRaw != null ? Number(b.supplyCapRaw - b.currentAssets) : -Infinity;
        return capB - capA;
      }
      case 'name-asc':
        return a.marketName.localeCompare(b.marketName);
      case 'allocated-desc':
      default: {
        if (Number(b.currentAssets) !== Number(a.currentAssets)) {
          return Number(b.currentAssets) - Number(a.currentAssets);
        }
        if (a.isIdle && !b.isIdle) return 1;
        if (!a.isIdle && b.isIdle) return -1;
        return 0;
      }
    }
  });

  const fmt = (v: number | null | undefined) =>
    v != null && Number.isFinite(v) ? formatPercentage(v, 2) : '—';

  // Live “remaining to allocate” helper.
  const plannedSum = resolvedAllocations?.sumAssets ?? BigInt(0);
  const remainingRaw = editing ? totalRawAssets - plannedSum : BigInt(0);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div>
            <CardTitle>Allocation</CardTitle>
            <CardDescription>
              Total: {formatCompactUSD(totalAssetsUsd)} ({formatRawTokenAmount(totalRawAssets, decimals, 2)} {assetSymbol})
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <AllocationFilters value={filters} onChange={setFilters} editing={editing} />
            {!editing ? (
              <Button variant="outline" size="sm" onClick={startEditing} className="flex items-center gap-1.5">
                <Pencil className="h-3.5 w-3.5" /> Reallocate
              </Button>
            ) : (
              <div className="flex items-center gap-2">
                <div className="flex gap-0.5 rounded-md border p-0.5">
                  <button
                    onClick={() => { setInputMode('percentage'); setEntries((prev) => prev.map((e) => ({ ...e, newValue: '' }))); }}
                    className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${inputMode === 'percentage' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                  >%</button>
                  <button
                    onClick={() => { setInputMode('tokens'); setEntries((prev) => prev.map((e) => ({ ...e, newValue: '' }))); }}
                    className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${inputMode === 'tokens' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                  >{assetSymbol || 'Tokens'}</button>
                </div>
                <Button variant="ghost" size="sm" onClick={cancelEditing}>Cancel</Button>
              </div>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {editing && (
          <RemainingBanner
            totalRaw={totalRawAssets}
            plannedRaw={plannedSum}
            remainingRaw={remainingRaw}
            decimals={decimals}
            symbol={assetSymbol}
          />
        )}

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
                <TableHead className="text-right">Cap</TableHead>
                <TableHead className="text-right">%</TableHead>
                {editing && <TableHead className="text-right w-40">New Allocation</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedAllocations.map((alloc) => {
                const pct = totalAssetsUsd > 0 ? (alloc.currentAssetsUsd / totalAssetsUsd) * 100 : 0;
                const rawPct = totalRawAssets > BigInt(0)
                  ? Number(alloc.currentAssets * BigInt(10000) / totalRawAssets) / 100
                  : 0;
                const entry = entryByKey.get(alloc.uniqueKey);

                const capRemaining = alloc.supplyCapRaw != null
                  ? (alloc.supplyCapRaw > alloc.currentAssets
                      ? alloc.supplyCapRaw - alloc.currentAssets
                      : BigInt(0))
                  : null;

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
                          {formatRawTokenAmount(alloc.currentAssets, alloc.decimals, 2)} {alloc.loanAssetSymbol || ''}
                        </span>
                        <span className="text-muted-foreground text-xs">{formatCompactUSD(alloc.currentAssetsUsd)}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      {alloc.supplyCapRaw == null ? (
                        <span className="text-muted-foreground text-xs">—</span>
                      ) : (
                        <div className="flex flex-col items-end gap-0.5">
                          <span className="text-xs">
                            {formatRawTokenAmount(alloc.supplyCapRaw, alloc.decimals, 2)}
                          </span>
                          <span className="text-muted-foreground text-[11px]">
                            {capRemaining != null
                              ? `+${formatRawTokenAmount(capRemaining, alloc.decimals, 2)} free`
                              : ''}
                          </span>
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {totalAssetsUsd > 0 ? `${pct.toFixed(2)}%` : '—'}
                    </TableCell>
                    {editing && (
                      <TableCell className="text-right">
                        {entry ? (
                          <div className="flex items-center justify-end gap-1">
                            <Input
                              type="text"
                              placeholder={inputMode === 'percentage' ? rawPct.toFixed(2) : formatTokenAmount(alloc.currentAssets, decimals, 4)}
                              value={entry.newValue}
                              onChange={(e) => updateEntry(entry.marketKey, e.target.value)}
                              className="text-right text-sm w-28 h-8"
                            />
                            <span className="text-xs text-muted-foreground w-6 text-left">
                              {inputMode === 'percentage' ? '%' : assetSymbol}
                            </span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
              {sortedAllocations.length === 0 && (
                <TableRow>
                  <TableCell colSpan={editing ? 9 : 8} className="text-center py-6 text-xs text-muted-foreground">
                    No markets match your filters.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        {editing && (
          <div className="mt-4 space-y-3">
            {resolvedAllocations?.error && (
              <div className="flex items-start gap-2 rounded-md bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 p-3">
                <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-red-700 dark:text-red-300">{resolvedAllocations.error}</p>
              </div>
            )}

            {resolvedAllocations?.valid && (
              <div className="flex items-start gap-2 rounded-md bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 p-3">
                <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-green-700 dark:text-green-300">
                  Ready to submit. The largest increase will use the{' '}
                  <span className="font-mono">uint256.max</span> catcher so interest accrual
                  between now and confirmation cannot cause an InconsistentReallocation revert.
                </p>
              </div>
            )}

            {vaultWrite.isSuccess && (
              <div className="flex items-start gap-2 rounded-md bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 p-3">
                <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-green-700 dark:text-green-300">
                  Transaction confirmed! Refresh to see updated allocations.
                </p>
              </div>
            )}

            {vaultWrite.error && (
              <div className="flex items-start gap-2 rounded-md bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 p-3">
                <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-red-700 dark:text-red-300 break-all">
                  {vaultWrite.error.message?.slice(0, 300)}
                </p>
              </div>
            )}

            <TransactionButton
              label={vaultWrite.isLoading ? 'Confirming...' : 'Reallocate'}
              onClick={handleReallocate}
              disabled={!resolvedAllocations?.valid}
              isLoading={vaultWrite.isLoading}
              isSuccess={vaultWrite.isSuccess}
              error={vaultWrite.error}
              txHash={vaultWrite.txHash}
            />

            {vaultWrite.txHash && (
              <p className="text-xs text-muted-foreground break-all">Tx: {vaultWrite.txHash}</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RemainingBanner({
  totalRaw,
  plannedRaw,
  remainingRaw,
  decimals,
  symbol,
}: {
  totalRaw: bigint;
  plannedRaw: bigint;
  remainingRaw: bigint;
  decimals: number;
  symbol: string;
}) {
  const isBalanced = remainingRaw === BigInt(0);
  const overshoot = remainingRaw < BigInt(0);
  const absRemaining = overshoot ? -remainingRaw : remainingRaw;

  const tone = isBalanced
    ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
    : overshoot
    ? 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800 text-red-800 dark:text-red-200'
    : 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200';

  const label = isBalanced
    ? 'Balanced — all funds are allocated.'
    : overshoot
    ? `Over-allocated by ${formatRawTokenAmount(absRemaining, decimals, 4)} ${symbol}. Reduce one of the targets.`
    : `Unallocated: ${formatRawTokenAmount(absRemaining, decimals, 4)} ${symbol}. The biggest increase will absorb this on-chain via the uint256.max catcher.`;

  return (
    <div className={`mb-3 rounded-md border p-3 text-xs ${tone}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>{label}</span>
        <span className="font-mono">
          planned {formatRawTokenAmount(plannedRaw, decimals, 2)} / {formatRawTokenAmount(totalRaw, decimals, 2)} {symbol}
        </span>
      </div>
    </div>
  );
}
