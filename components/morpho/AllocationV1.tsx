'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { useVault } from '@/lib/hooks/useProtocolStats';
import {
  formatCompactUSD,
  formatFullUSD,
  formatPercentage,
  formatLtv,
  formatTokenAmount,
  formatRawTokenAmount,
} from '@/lib/format/number';
import {
  getTokenDisplayDecimals,
  resolveAssetDecimals,
} from '@/lib/format/asset-decimals';
import type { AllocationAmountUnit } from '@/components/morpho/AllocationFilters';
import {
  formatAllocationAmount,
  formatCapRawAmount,
} from '@/lib/format/allocation-display';
import { Pencil, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useVaultWrite } from '@/lib/hooks/useVaultWrite';
import { TransactionButton } from '@/components/TransactionButton';
import { v1WriteConfigs, type MarketParams } from '@/lib/onchain/vault-writes';
import type { Address } from 'viem';
import { parseUnits } from 'viem';
import {
  buildV1ReallocationPlan,
  ZERO_ADDRESS,
  type ReallocationTarget,
} from '@/lib/onchain/reallocation';
import {
  applyPlanningDust,
  pickLargestAssetsIndex,
  resolveDustRecipientIndex,
  type DustRecipientChoice,
} from '@/lib/onchain/allocation-dust';
import { DustRecipientSelect } from '@/components/morpho/DustRecipientSelect';
import {
  AllocationFilters,
  DEFAULT_FILTER_STATE,
  type AllocationFilterState,
} from '@/components/morpho/AllocationFilters';
import {
  AllocationExtraColumn,
  AllocationListHeader,
  AllocationListRow,
  AllocationListSection,
  AllocationListShell,
  AllocationPill,
  formatListAllocationAmount,
  formatMarketPairLabel,
  formatLltvPill,
  getActiveExtraColumns,
} from '@/components/morpho/AllocationListView';

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
  const [dustRecipientKey, setDustRecipientKey] = useState<DustRecipientChoice>('auto');
  const vaultWrite = useVaultWrite();

  const totalAssetsUsd = useMemo(() => {
    return vault?.allocation?.reduce((sum, alloc) => sum + (alloc.supplyAssetsUsd ?? 0), 0) ?? 0;
  }, [vault?.allocation]);

  const totalRawAssets = useMemo(() => {
    let total = BigInt(0);
    allocations.forEach((a) => { total += a.currentAssets; });
    return total;
  }, [allocations]);

  const assetSymbol = useMemo(() => {
    const first = allocations.values().next();
    return (first.done ? null : first.value?.loanAssetSymbol) ?? vault?.asset ?? '';
  }, [allocations, vault?.asset]);

  const vaultDecimals = resolveAssetDecimals(vault?.asset ?? assetSymbol, vault?.assetDecimals);
  const vaultDisplayDecimals = getTokenDisplayDecimals(vault?.asset ?? assetSymbol, vaultDecimals);

  useEffect(() => {
    if (!vault?.allocation || allocations.size > 0) return;
    const dec = resolveAssetDecimals(vault?.asset, vault?.assetDecimals);
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
      const name = formatMarketPairLabel(col, loan);

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
    setDustRecipientKey('auto');
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
    let targets: Target[] = [];
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
          const raw = parseUnits(e.newValue, vaultDecimals);
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

    if (errorMsg) {
      return {
        valid: false as const,
        error: errorMsg,
        targets: [] as Target[],
        sumAssets: BigInt(0),
        dustDiff: BigInt(0),
        dustRecipientKey: null as string | null,
      };
    }
    if (targets.length !== entries.length) {
      return {
        valid: false as const,
        error: 'Missing entries',
        targets: [] as Target[],
        sumAssets: BigInt(0),
        dustDiff: BigInt(0),
        dustRecipientKey: null as string | null,
      };
    }

    // Apply rounding dust to the selected recipient (default: largest target).
    const inputSum = targets.reduce((s, t) => s + t.assets, BigInt(0));
    const recipientIdx = resolveDustRecipientIndex(
      targets,
      dustRecipientKey,
      (t) => t.key,
      (items) => pickLargestAssetsIndex(items, (t) => t.assets)
    );
    const dustResult = applyPlanningDust(
      targets,
      totalRawAssets,
      recipientIdx,
      (t) => t.assets,
      (t, assets) => ({ ...t, assets })
    );
    if (dustResult.error) {
      return {
        valid: false as const,
        error: dustResult.error,
        targets: [] as Target[],
        sumAssets: BigInt(0),
        dustDiff: BigInt(0),
        dustRecipientKey: null as string | null,
      };
    }
    targets = dustResult.items;
    const dustDiff = dustResult.diff;
    const dustRecipientMarketKey = targets[recipientIdx]?.key ?? null;

    if (targets.some((t) => t.assets < BigInt(0))) {
      return {
        valid: false as const,
        error: 'Allocation would go negative after dust adjustment',
        targets: [] as Target[],
        sumAssets: BigInt(0),
        dustDiff: BigInt(0),
        dustRecipientKey: null as string | null,
      };
    }

    // Cap validation
    for (const t of targets) {
      if (t.assets <= t.current) continue;
      const alloc = allocations.get(t.key);
      if (!alloc?.supplyCapRaw) continue;
      if (t.assets > alloc.supplyCapRaw) {
        return {
          valid: false as const,
          error: `${alloc.marketName}: allocation exceeds supply cap (${formatRawTokenAmount(alloc.supplyCapRaw, resolveAssetDecimals(alloc.loanAssetSymbol, alloc.decimals), getTokenDisplayDecimals(alloc.loanAssetSymbol, alloc.decimals))} ${alloc.loanAssetSymbol ?? ''})`,
          targets: [] as Target[],
          sumAssets: BigInt(0),
          dustDiff: BigInt(0),
          dustRecipientKey: null as string | null,
        };
      }
    }

    const anyChanged = targets.some((t) => t.assets !== t.current);
    if (!anyChanged) {
      return {
        valid: false as const,
        error: null,
        targets,
        inputSum,
        sumAssets: inputSum,
        dustDiff,
        dustRecipientKey: dustRecipientMarketKey,
      };
    }

    return {
      valid: true as const,
      error: null,
      targets,
      inputSum,
      sumAssets: inputSum,
      dustDiff,
      dustRecipientKey: dustRecipientMarketKey,
    };
  }, [editing, entries, inputMode, allocations, totalRawAssets, vaultDecimals, dustRecipientKey]);

  const handleReallocate = useCallback(() => {
    if (!resolvedAllocations?.valid) return;

    // Resolve key → MarketParams; we feed this into the pure planner so the
    // ordering + catcher logic stays unit tested in
    // lib/onchain/__tests__/reallocation.test.ts.
    const getMarketParams = (key: string): MarketParams | null => {
      const alloc = allocations.get(key);
      if (!alloc) return null;
      return {
        loanToken: (alloc.loanAssetAddress || ZERO_ADDRESS) as Address,
        collateralToken: (alloc.collateralAssetAddress || ZERO_ADDRESS) as Address,
        oracle: (alloc.oracleAddress || ZERO_ADDRESS) as Address,
        irm: (alloc.irmAddress || ZERO_ADDRESS) as Address,
        lltv: alloc.lltvRaw ? BigInt(alloc.lltvRaw) : BigInt(0),
      };
    };

    const targets: ReallocationTarget[] = resolvedAllocations.targets.map((t) => ({
      key: t.key,
      assets: t.assets,
      current: t.current,
    }));

    const plan = buildV1ReallocationPlan(targets, getMarketParams, {
      catcherKey: dustRecipientKey,
    });
    if (plan.allocations.length === 0) return;
    vaultWrite.write(v1WriteConfigs.reallocate(vaultAddress as Address, plan.allocations));
  }, [resolvedAllocations, allocations, vaultAddress, vaultWrite, dustRecipientKey]);

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
  const plannedSum = resolvedAllocations?.inputSum ?? BigInt(0);
  const remainingRaw = editing ? totalRawAssets - plannedSum : BigInt(0);

  const dustOptions = useMemo(
    () =>
      Array.from(allocations.values()).map((a) => ({
        id: a.uniqueKey,
        label: a.marketName,
      })),
    [allocations]
  );

  const dustRecipientLabel = useMemo(() => {
    if (!resolvedAllocations?.dustRecipientKey) return null;
    return allocations.get(resolvedAllocations.dustRecipientKey)?.marketName ?? null;
  }, [resolvedAllocations?.dustRecipientKey, allocations]);

  const extraColumnLabels = getActiveExtraColumns(filters.columns).map((c) => c.label);

  const v1IdleRows = sortedAllocations.filter(
    (alloc) => alloc.isIdle || formatLtv(alloc.lltv) === '—'
  );
  const v1BlueRows = sortedAllocations.filter(
    (alloc) => !(alloc.isIdle || formatLtv(alloc.lltv) === '—')
  );
  const v1Sections = [
    { key: 'idle', title: 'Idle', rows: v1IdleRows },
    { key: 'blue', title: 'Morpho Blue Market', rows: v1BlueRows },
  ].filter((section) => section.rows.length > 0);

  const renderV1Row = (alloc: MarketAllocationInput) => {
    const pct = totalAssetsUsd > 0 ? (alloc.currentAssetsUsd / totalAssetsUsd) * 100 : 0;
    const rawPct =
      totalRawAssets > BigInt(0)
        ? Number(alloc.currentAssets * BigInt(10000) / totalRawAssets) / 100
        : 0;
    const entry = entryByKey.get(alloc.uniqueKey);
    const rowIsIdle = alloc.isIdle || formatLtv(alloc.lltv) === '—';
    const lltvPill = rowIsIdle ? null : formatLltvPill(alloc.lltv);
    const displayName = rowIsIdle ? 'Idle' : alloc.marketName;
    const sym = alloc.loanAssetSymbol || assetSymbol;

    const mainAmount =
      filters.displayMode === 'percent'
        ? `${pct.toFixed(2)}%`
        : filters.amountUnit === 'usd'
          ? formatFullUSD(alloc.currentAssetsUsd, 2)
          : formatListAllocationAmount(alloc.currentAssets, sym, alloc.decimals);

    const percentCapValue =
      alloc.supplyCapRaw != null && totalRawAssets > BigInt(0)
        ? `${(Number((alloc.supplyCapRaw * BigInt(10000)) / totalRawAssets) / 100).toFixed(2)}%`
        : '—';

    return (
      <AllocationListRow
        key={alloc.uniqueKey}
        className={rowIsIdle ? 'bg-muted/30' : undefined}
        name={
          rowIsIdle ? (
            displayName
          ) : (
            <a
              href={`https://app.morpho.org/base/market/${alloc.uniqueKey}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-foreground hover:text-foreground"
            >
              {displayName}
            </a>
          )
        }
        tags={lltvPill ? <AllocationPill>{lltvPill}</AllocationPill> : undefined}
        amount={mainAmount}
        extraCells={
          <>
            {filters.columns.utilization && (
              <AllocationExtraColumn label="Util." value={fmt(alloc.utilization)} />
            )}
            {filters.columns.liquidity && (
              <AllocationExtraColumn
                label="Liquidity"
                value={
                  alloc.liquidityAssetsUsd != null && Number.isFinite(alloc.liquidityAssetsUsd)
                    ? formatCompactUSD(alloc.liquidityAssetsUsd)
                    : '—'
                }
              />
            )}
            {filters.columns.borrowApy && (
              <AllocationExtraColumn label="Borrow" value={fmt(alloc.borrowApy)} />
            )}
            {filters.columns.supplyApy && (
              <AllocationExtraColumn label="Supply" value={fmt(alloc.supplyApy)} />
            )}
            {filters.columns.allocated && (
              <AllocationExtraColumn
                label="Allocated"
                value={
                  filters.displayMode === 'percent'
                    ? totalAssetsUsd > 0
                      ? `${pct.toFixed(2)}%`
                      : '—'
                    : formatAllocationAmount(
                        filters.amountUnit,
                        alloc.currentAssetsUsd,
                        alloc.currentAssets,
                        sym,
                        alloc.decimals
                      )
                }
              />
            )}
            {filters.columns.effectiveCap && (
              <AllocationExtraColumn
                label="Eff. cap"
                value={
                  alloc.supplyCapRaw == null
                    ? '—'
                    : filters.displayMode === 'percent' && totalRawAssets > BigInt(0)
                      ? percentCapValue
                      : formatCapRawAmount(alloc.supplyCapRaw, sym, alloc.decimals)
                }
              />
            )}
            {filters.columns.percentCap && (
              <AllocationExtraColumn label="% cap" value={percentCapValue} />
            )}
          </>
        }
        editingCell={
          editing && entry ? (
            <div className="flex min-w-[7rem] items-center justify-end gap-1">
              <Input
                type="text"
                placeholder={
                  inputMode === 'percentage'
                    ? rawPct.toFixed(2)
                    : formatTokenAmount(
                        alloc.currentAssets,
                        vaultDecimals,
                        Math.min(4, vaultDisplayDecimals)
                      )
                }
                value={entry.newValue}
                onChange={(e) => updateEntry(entry.marketKey, e.target.value)}
                className="h-8 w-28 text-right text-sm"
              />
              <span className="w-6 text-left text-xs text-muted-foreground">
                {inputMode === 'percentage' ? '%' : assetSymbol}
              </span>
            </div>
          ) : undefined
        }
      />
    );
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div>
            <CardTitle>Allocation</CardTitle>
            <CardDescription>
              Total:{' '}
              {filters.amountUnit === 'usd'
                ? formatFullUSD(totalAssetsUsd, 2)
                : `${formatRawTokenAmount(totalRawAssets, vaultDecimals, vaultDisplayDecimals)} ${assetSymbol}`}
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
          <div className="mb-3 space-y-2">
            <RemainingBanner
              totalRaw={totalRawAssets}
              plannedRaw={plannedSum}
              remainingRaw={remainingRaw}
              decimals={vaultDecimals}
              displayDecimals={vaultDisplayDecimals}
              symbol={assetSymbol}
              amountUnit={filters.amountUnit}
              dustDiff={resolvedAllocations?.dustDiff ?? BigInt(0)}
              dustRecipientLabel={dustRecipientLabel}
              dustIsAuto={dustRecipientKey === 'auto'}
            />
            <DustRecipientSelect
              value={dustRecipientKey}
              onChange={setDustRecipientKey}
              options={dustOptions}
            />
          </div>
        )}

        <AllocationListShell>
          <AllocationListHeader columnLabels={extraColumnLabels} editing={editing} />
          {sortedAllocations.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-muted-foreground">
              No markets match your filters.
            </div>
          ) : (
            v1Sections.map((section) => (
              <AllocationListSection key={section.key} title={section.title}>
                {section.rows.map((alloc) => renderV1Row(alloc))}
              </AllocationListSection>
            ))
          )}
        </AllocationListShell>

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
                  Ready to submit. Rounding dust goes to{' '}
                  {dustRecipientKey === 'auto'
                    ? 'the largest target'
                    : dustRecipientLabel ?? 'your selected market'}
                  ; that deposit also uses the{' '}
                  <span className="font-mono">uint256.max</span> on-chain catcher when withdrawals
                  are present.
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
  displayDecimals,
  symbol,
  amountUnit,
  dustDiff = BigInt(0),
  dustRecipientLabel,
  dustIsAuto = true,
}: {
  totalRaw: bigint;
  plannedRaw: bigint;
  remainingRaw: bigint;
  decimals: number;
  displayDecimals: number;
  symbol: string;
  amountUnit: AllocationAmountUnit;
  dustDiff?: bigint;
  dustRecipientLabel?: string | null;
  dustIsAuto?: boolean;
}) {
  const isBalanced = remainingRaw === BigInt(0);
  const overshoot = remainingRaw < BigInt(0);
  const absRemaining = overshoot ? -remainingRaw : remainingRaw;
  const dustApplied = dustDiff !== BigInt(0);
  const dustTarget =
    dustIsAuto ? 'largest target' : dustRecipientLabel ?? 'selected market';

  const tone = isBalanced
    ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
    : overshoot
    ? 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800 text-red-800 dark:text-red-200'
    : 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200';

  const label = isBalanced
    ? dustApplied
      ? `Balanced — ${formatRawTokenAmount(dustDiff, decimals, Math.min(4, displayDecimals))} ${symbol} rounding applied to ${dustTarget}.`
      : 'Balanced — all funds are allocated.'
    : overshoot
    ? `Over-allocated by ${formatRawTokenAmount(absRemaining, decimals, Math.min(4, displayDecimals))} ${symbol}. Reduce one of the targets.`
    : `Unallocated: ${formatRawTokenAmount(absRemaining, decimals, Math.min(4, displayDecimals))} ${symbol}. Remainder will go to ${dustTarget}.`;

  const fmt = (v: bigint) =>
    amountUnit === 'usd'
      ? '—'
      : formatRawTokenAmount(v, decimals, displayDecimals);

  return (
    <div className={`mb-3 rounded-md border p-3 text-xs ${tone}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>{label}</span>
        <span className="font-mono tabular-nums">
          planned {fmt(plannedRaw)} / {fmt(totalRaw)} {amountUnit === 'token' ? symbol : ''}
        </span>
      </div>
    </div>
  );
}
