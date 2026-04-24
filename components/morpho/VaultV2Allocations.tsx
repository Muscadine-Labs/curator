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
import { AlertTriangle, CheckCircle2, Pencil } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useVaultV2Risk } from '@/lib/hooks/useVaultV2Risk';
import { useVaultV2Governance } from '@/lib/hooks/useVaultV2Governance';
import { useVaultWrite } from '@/lib/hooks/useVaultWrite';
import { TransactionButton } from '@/components/TransactionButton';
import { v2WriteConfigs } from '@/lib/onchain/vault-writes';
import type { Address, Hex } from 'viem';
import {
  parseUnits,
  encodeAbiParameters,
  parseAbiParameters,
  keccak256,
} from 'viem';
import {
  formatCompactUSD,
  formatPercentage,
  formatLtv,
  formatTokenAmount,
  formatRawTokenAmount,
} from '@/lib/format/number';
import type { V2VaultRiskResponse } from '@/app/api/vaults/v2/[id]/risk/route';
import type { VaultV2GovernanceResponse, CapInfo } from '@/app/api/vaults/v2/[id]/governance/route';
import {
  AllocationFilters,
  DEFAULT_FILTER_STATE,
  type AllocationFilterState,
} from '@/components/morpho/AllocationFilters';

interface VaultV2AllocationsProps {
  vaultAddress: string;
  /** Preloaded governance (from parent). Contains caps/timelocks/etc. */
  preloadedData?: VaultV2GovernanceResponse | null;
  /** Preloaded risk data (adapters+markets+allocations). Optional. */
  preloadedRisk?: V2VaultRiskResponse | null;
}

function formatOrDash(value: number | null | undefined): string {
  return value != null && Number.isFinite(value) ? formatPercentage(value, 2) : '—';
}

function scalePercent(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return value * 100;
}

type AdapterType = 'MetaMorphoAdapter' | 'MorphoMarketV1Adapter' | string;

/** One allocation target that can be individually allocated/deallocated. */
interface AllocTarget {
  label: string;
  adapterAddress: string;
  adapterType: AdapterType;
  /** ABI-encoded data param for allocate/deallocate. MetaMorpho=0x, Market=encoded market params */
  data: Hex;
  /** keccak256(data) — the primary cap id used by the vault. */
  capIdHash: Hex;
  currentAssets: bigint;
  currentUsd: number;
  decimals: number;
  symbol: string;
  isMetaMorpho: boolean;
  /** Absolute cap in raw token units (null when unknown). */
  absoluteCapRaw: bigint | null;
  /** Relative cap as WAD (1e18 = 100%). Null when unknown. */
  relativeCapWad: bigint | null;
}

type InputMode = 'tokens' | 'percentage';

function encodeMarketData(market: {
  loanAsset?: { address: string } | null;
  collateralAsset?: { address: string } | null;
  oracleAddress?: string | null;
  irmAddress?: string | null;
  lltv?: string | number | null;
}): Hex {
  const loan = market.loanAsset?.address || '0x0000000000000000000000000000000000000000';
  const col = market.collateralAsset?.address || '0x0000000000000000000000000000000000000000';
  const oracle = market.oracleAddress || '0x0000000000000000000000000000000000000000';
  const irm = market.irmAddress || '0x0000000000000000000000000000000000000000';
  const lltv = market.lltv ? BigInt(market.lltv) : BigInt(0);

  return encodeAbiParameters(
    parseAbiParameters('address, address, address, address, uint256'),
    [loan as Address, col as Address, oracle as Address, irm as Address, lltv]
  );
}

/** Encode adapter-scoped cap data (MetaMorphoAdapter): `address`. */
function encodeAdapterCapData(adapterAddress: string): Hex {
  return encodeAbiParameters(parseAbiParameters('address'), [adapterAddress as Address]);
}

function parseBigIntOrNull(s: string | number | null | undefined): bigint | null {
  if (s == null) return null;
  try {
    return typeof s === 'bigint' ? s : BigInt(typeof s === 'number' ? Math.floor(s).toString() : s.toString());
  } catch {
    return null;
  }
}

/** Display-only row (sub-markets under an adapter). */
type DisplayRow = {
  kind: 'display';
  market: string;
  lltv: string | number | null;
  utilization: number | null;
  liquidity: number | null;
  borrowApy: number | null;
  supplyApy: number | null;
  allocated: number;
  pct: number;
  allocAssets: string | null;
  allocDecimals: number;
  allocSymbol: string | null;
};

/** Adapter-level row that maps 1-to-1 with an AllocTarget. */
type TargetRow = {
  kind: 'target';
  targetIdx: number;
  market: string;
  isIdle: boolean;
  supplyApy: number | null;
  liquidity: number | null;
  allocated: number;
  pct: number;
  allocAssets: string | null;
  allocDecimals: number;
  allocSymbol: string | null;
  /** For filtering */
  searchHaystack: string;
};

type RowType = TargetRow | DisplayRow;

export function VaultV2Allocations({ vaultAddress, preloadedData, preloadedRisk }: VaultV2AllocationsProps) {
  const { data: fetchedRisk, isLoading, error } = useVaultV2Risk(vaultAddress);
  const { data: fetchedGov } = useVaultV2Governance(vaultAddress);
  const risk = preloadedRisk ?? fetchedRisk;
  const governance = preloadedData ?? fetchedGov;

  const capByIdHash = useMemo(() => {
    const map = new Map<string, CapInfo>();
    for (const cap of governance?.caps ?? []) {
      // Build idHash for each cap based on its kind.
      if (cap.adapterAddress && cap.type === 'adapter') {
        const h = keccak256(encodeAdapterCapData(cap.adapterAddress));
        map.set(h.toLowerCase(), cap);
      }
      if (cap.marketKey && cap.type === 'market') {
        // MarketV1CapData id = keccak256(MarketParams tuple) — cannot rebuild
        // without full market params. We instead key by marketKey for lookup.
        map.set(cap.marketKey.toLowerCase(), cap);
      }
    }
    return map;
  }, [governance]);

  /** Lookup caps for a target. Prefers exact idHash, then falls back by address/marketKey. */
  const capsForTarget = useCallback(
    (t: AllocTarget, marketKey?: string): CapInfo | null => {
      const byHash = capByIdHash.get(t.capIdHash.toLowerCase());
      if (byHash) return byHash;
      if (t.isMetaMorpho) {
        const byAdapter = (governance?.caps ?? []).find(
          (c) => c.adapterAddress?.toLowerCase() === t.adapterAddress.toLowerCase() && c.type === 'adapter'
        );
        if (byAdapter) return byAdapter;
      } else if (marketKey) {
        const byMarket = capByIdHash.get(marketKey.toLowerCase());
        if (byMarket) return byMarket;
      }
      return null;
    },
    [capByIdHash, governance?.caps]
  );

  const { rows, totalUsd, targets, totalRawAssets, vaultDecimals, vaultSymbol } = useMemo(() => {
    if (!risk?.adapters) {
      return {
        rows: [] as RowType[],
        totalUsd: 0,
        targets: [] as AllocTarget[],
        totalRawAssets: BigInt(0),
        vaultDecimals: 18,
        vaultSymbol: '',
      };
    }

    const totalUsd = risk.totalAdapterAssetsUsd ?? 0;
    const va = risk.vaultAsset;
    const dec = va?.decimals ?? 18;
    const sym = va?.symbol ?? '';
    const adapterList = (risk.adapters ?? []).slice().sort((a, b) => (b.allocationUsd ?? 0) - (a.allocationUsd ?? 0));

    const rows: RowType[] = [];
    const targets: AllocTarget[] = [];
    let totalRaw = BigInt(0);

    for (const adapter of adapterList) {
      const markets = adapter.markets ?? [];
      const isMetaMorpho = adapter.adapterType === 'MetaMorphoAdapter';

      if (isMetaMorpho) {
        const adapterPct = totalUsd > 0 ? ((adapter.allocationUsd ?? 0) / totalUsd) * 100 : 0;
        let adapterSupplyApy: number | null = null;
        let adapterLiquidity: number | null = null;
        if (markets.length > 0) {
          const ta = markets.reduce((s, m) => s + (m.allocationUsd ?? 0), 0);
          if (ta > 0) adapterSupplyApy = markets.reduce((s, m) => s + ((m.market?.state?.supplyApy ?? 0) * (m.allocationUsd ?? 0)), 0) / ta;
          const sumLiq = markets.reduce((s, m) => s + (m.market?.state?.liquidityAssetsUsd ?? 0), 0);
          if (Number.isFinite(sumLiq)) adapterLiquidity = sumLiq;
        }
        const allocAssets = adapter.allocationAssets ?? null;
        const allocDec = markets[0]?.market?.loanAsset?.decimals ?? dec;
        const allocSym = markets[0]?.market?.loanAsset?.symbol ?? sym;

        const tIdx = targets.length;
        let rawAssets = BigInt(0);
        if (allocAssets) { try { rawAssets = BigInt(allocAssets); } catch { /* */ } }
        totalRaw += rawAssets;

        const adapterDataHex = '0x' as Hex;
        const adapterIdData = encodeAdapterCapData(adapter.adapterAddress);
        const adapterIdHash = keccak256(adapterIdData);

        targets.push({
          label: adapter.adapterLabel || 'MetaMorpho',
          adapterAddress: adapter.adapterAddress,
          adapterType: adapter.adapterType,
          data: adapterDataHex,
          capIdHash: adapterIdHash,
          currentAssets: rawAssets,
          currentUsd: adapter.allocationUsd ?? 0,
          decimals: allocDec,
          symbol: allocSym,
          isMetaMorpho: true,
          absoluteCapRaw: null,
          relativeCapWad: null,
        });

        rows.push({
          kind: 'target',
          targetIdx: tIdx,
          market: adapter.adapterLabel || 'MetaMorpho Adapter',
          isIdle: markets.length === 0,
          supplyApy: adapterSupplyApy,
          liquidity: adapterLiquidity,
          allocated: adapter.allocationUsd ?? 0,
          pct: adapterPct,
          allocAssets,
          allocDecimals: allocDec,
          allocSymbol: allocSym,
          searchHaystack: `${adapter.adapterLabel ?? ''} ${allocSym ?? ''}`.toLowerCase(),
        });

        for (const m of markets.slice().sort((a, b) => (b.allocationUsd ?? 0) - (a.allocationUsd ?? 0))) {
          const col = m.market?.collateralAsset?.symbol;
          const loan = m.market?.loanAsset?.symbol;
          rows.push({
            kind: 'display',
            market: col && loan ? `${col}/${loan}` : loan || col || 'Market',
            lltv: m.market?.lltv ?? null,
            utilization: m.market?.state?.utilization ?? null,
            liquidity: m.market?.state?.liquidityAssetsUsd ?? null,
            borrowApy: m.market?.state?.borrowApy ?? null,
            supplyApy: m.market?.state?.supplyApy ?? null,
            allocated: m.allocationUsd ?? 0,
            pct: totalUsd > 0 ? ((m.allocationUsd ?? 0) / totalUsd) * 100 : 0,
            allocAssets: m.allocationAssets ?? null,
            allocDecimals: m.market?.loanAsset?.decimals ?? 18,
            allocSymbol: m.market?.loanAsset?.symbol ?? null,
          });
        }
      } else {
        const sortedMarkets = markets.slice().sort((a, b) => (b.allocationUsd ?? 0) - (a.allocationUsd ?? 0));
        for (const m of sortedMarkets) {
          const col = m.market?.collateralAsset?.symbol;
          const loan = m.market?.loanAsset?.symbol;
          const label = col && loan ? `${col}/${loan}` : loan || col || adapter.adapterLabel || 'Market';
          const allocAssets = m.allocationAssets ?? null;
          const allocDec = m.market?.loanAsset?.decimals ?? dec;
          const allocSym = m.market?.loanAsset?.symbol ?? sym;
          const mktPct = totalUsd > 0 ? ((m.allocationUsd ?? 0) / totalUsd) * 100 : 0;

          let rawAssets = BigInt(0);
          if (allocAssets) { try { rawAssets = BigInt(allocAssets); } catch { /* */ } }
          totalRaw += rawAssets;

          const data = m.market ? encodeMarketData(m.market) : ('0x' as Hex);
          const idHash = keccak256(data);

          const tIdx = targets.length;
          targets.push({
            label,
            adapterAddress: adapter.adapterAddress,
            adapterType: adapter.adapterType,
            data,
            capIdHash: idHash,
            currentAssets: rawAssets,
            currentUsd: m.allocationUsd ?? 0,
            decimals: allocDec,
            symbol: allocSym,
            isMetaMorpho: false,
            absoluteCapRaw: null,
            relativeCapWad: null,
          });

          rows.push({
            kind: 'target',
            targetIdx: tIdx,
            market: label,
            isIdle: !m.market?.lltv,
            supplyApy: m.market?.state?.supplyApy ?? null,
            liquidity: m.market?.state?.liquidityAssetsUsd ?? null,
            allocated: m.allocationUsd ?? 0,
            pct: mktPct,
            allocAssets,
            allocDecimals: allocDec,
            allocSymbol: allocSym,
            searchHaystack: `${label} ${allocSym ?? ''}`.toLowerCase(),
          });
        }
      }
    }

    return { rows, totalUsd, targets, totalRawAssets: totalRaw, vaultDecimals: dec, vaultSymbol: sym };
  }, [risk]);

  // Attach caps to each target now that `targets` and `capByIdHash` are known.
  const targetsWithCaps: AllocTarget[] = useMemo(() => {
    return targets.map((t) => {
      const marketKey =
        !t.isMetaMorpho
          ? (risk?.adapters ?? [])
              .flatMap((a) => a.markets ?? [])
              .find((m) => {
                if (!m.market) return false;
                const data = encodeMarketData(m.market);
                return data.toLowerCase() === t.data.toLowerCase();
              })?.market?.uniqueKey ?? undefined
          : undefined;
      const cap = capsForTarget(t, marketKey);
      return {
        ...t,
        absoluteCapRaw: cap ? parseBigIntOrNull(cap.absoluteCap) : null,
        relativeCapWad: cap ? parseBigIntOrNull(cap.relativeCap) : null,
      };
    });
  }, [targets, capsForTarget, risk?.adapters]);

  const [editing, setEditing] = useState(false);
  const [inputMode, setInputMode] = useState<InputMode>('percentage');
  const [inputValues, setInputValues] = useState<string[]>([]);
  const [filters, setFilters] = useState<AllocationFilterState>(DEFAULT_FILTER_STATE);
  const multicallWrite = useVaultWrite();

  const startEditing = useCallback(() => {
    setInputValues(targetsWithCaps.map(() => ''));
    setEditing(true);
  }, [targetsWithCaps]);

  const cancelEditing = useCallback(() => {
    setEditing(false);
    multicallWrite.reset();
  }, [multicallWrite]);

  const updateInput = useCallback((idx: number, val: string) => {
    setInputValues((prev) => prev.map((v, i) => i === idx ? val : v));
  }, []);

  const resolvedAllocations = useMemo(() => {
    if (!editing || inputValues.length === 0 || inputValues.length !== targetsWithCaps.length) return null;

    const modified = inputValues.filter((v) => v.trim() !== '');
    if (modified.length === 0) return null;

    type Result = { target: AllocTarget; assets: bigint; current: bigint };
    const results: Result[] = [];
    let errorMsg: string | null = null;

    for (let i = 0; i < targetsWithCaps.length; i++) {
      const t = targetsWithCaps[i];
      const v = inputValues[i];

      if (v.trim() === '') {
        results.push({ target: t, assets: t.currentAssets, current: t.currentAssets });
        continue;
      }

      if (inputMode === 'percentage') {
        const pct = parseFloat(v);
        if (isNaN(pct) || pct < 0 || pct > 100) {
          errorMsg = `Invalid percentage for ${t.label}`;
          break;
        }
        const raw = totalRawAssets * BigInt(Math.round(pct * 1e10)) / BigInt(1e12);
        results.push({ target: t, assets: raw, current: t.currentAssets });
      } else {
        try {
          const raw = parseUnits(v, t.decimals);
          if (raw < BigInt(0)) { errorMsg = `Negative amount for ${t.label}`; break; }
          results.push({ target: t, assets: raw, current: t.currentAssets });
        } catch {
          errorMsg = `Invalid number for ${t.label}`;
          break;
        }
      }
    }

    if (errorMsg) return { valid: false as const, error: errorMsg, results: [] as Result[], sumAssets: BigInt(0) };
    if (results.length !== targetsWithCaps.length) {
      return { valid: false as const, error: 'Missing entries', results: [] as Result[], sumAssets: BigInt(0) };
    }

    let sum = results.reduce((s, r) => s + r.assets, BigInt(0));
    const diff = totalRawAssets - sum;
    if (diff !== BigInt(0) && results.length > 0) {
      const largest = results.reduce((best, r) => r.assets > best.assets ? r : best, results[0]);
      largest.assets += diff;
      sum = totalRawAssets;
    }

    if (results.some((r) => r.assets < BigInt(0))) {
      return { valid: false as const, error: 'Allocation would go negative after dust adjustment', results: [] as Result[], sumAssets: BigInt(0) };
    }

    // Cap validation
    for (const r of results) {
      if (r.assets <= r.current) continue;
      const t = r.target;
      if (t.absoluteCapRaw != null && r.assets > t.absoluteCapRaw) {
        return {
          valid: false as const,
          error: `${t.label}: allocation exceeds absolute cap (${formatRawTokenAmount(t.absoluteCapRaw, t.decimals, 2)} ${t.symbol}).`,
          results: [] as Result[],
          sumAssets: BigInt(0),
        };
      }
      if (t.relativeCapWad != null && totalRawAssets > BigInt(0)) {
        // allocation <= firstTotalAssets * relativeCap / 1e18 — we use totalRawAssets as proxy for firstTotalAssets.
        const wad = BigInt('1000000000000000000');
        const maxAllowed = (totalRawAssets * t.relativeCapWad) / wad;
        if (t.relativeCapWad < wad && r.assets > maxAllowed) {
          return {
            valid: false as const,
            error: `${t.label}: allocation exceeds relative cap (${(Number(t.relativeCapWad) / 1e16).toFixed(2)}% of vault).`,
            results: [] as Result[],
            sumAssets: BigInt(0),
          };
        }
      }
    }

    const anyChanged = results.some((r) => r.assets !== r.current);
    if (!anyChanged) {
      return { valid: false as const, error: null, results: [] as Result[], sumAssets: sum };
    }

    return { valid: true as const, error: null, results, sumAssets: sum };
  }, [editing, inputValues, targetsWithCaps, inputMode, totalRawAssets]);

  const handleRebalance = useCallback(() => {
    if (!resolvedAllocations?.valid) return;

    const deallocCalls: Hex[] = [];
    const allocCalls: Hex[] = [];

    for (const r of resolvedAllocations.results) {
      if (r.assets === r.current) continue;
      if (r.assets < r.current) {
        const delta = r.current - r.assets;
        deallocCalls.push(v2WriteConfigs.encodeDeallocate(
          r.target.adapterAddress as Address,
          r.target.data,
          delta
        ));
      } else {
        const delta = r.assets - r.current;
        allocCalls.push(v2WriteConfigs.encodeAllocate(
          r.target.adapterAddress as Address,
          r.target.data,
          delta
        ));
      }
    }

    const allCalls = [...deallocCalls, ...allocCalls];
    if (allCalls.length === 0) return;

    if (allCalls.length === 1) {
      const r = resolvedAllocations.results.find((r) => r.assets !== r.current)!;
      if (r.assets > r.current) {
        multicallWrite.write(v2WriteConfigs.allocate(
          vaultAddress as Address,
          r.target.adapterAddress as Address,
          r.target.data,
          r.assets - r.current
        ));
      } else {
        multicallWrite.write(v2WriteConfigs.deallocate(
          vaultAddress as Address,
          r.target.adapterAddress as Address,
          r.target.data,
          r.current - r.assets
        ));
      }
    } else {
      multicallWrite.write(v2WriteConfigs.multicall(vaultAddress as Address, allCalls));
    }
  }, [resolvedAllocations, vaultAddress, multicallWrite]);

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

  // --- Filtering & sorting -------------------------------------------------
  // We only filter TARGET rows (adapters / markets). Display rows (sub-markets
  // below a MetaMorpho adapter) are kept alongside their parent adapter.
  const search = filters.search.trim().toLowerCase();

  // Map target index -> whether it should be shown
  const showTarget = new Map<number, boolean>();
  for (const r of rows) {
    if (r.kind !== 'target') continue;
    const t = targetsWithCaps[r.targetIdx];
    if (!t) { showTarget.set(r.targetIdx, false); continue; }

    const entryVal = editing ? inputValues[r.targetIdx] ?? '' : '';
    const isEdited = entryVal.trim() !== '';
    const isIdleRow = r.isIdle;
    const cap = t.absoluteCapRaw;

    let show = true;
    if (search && !r.searchHaystack.includes(search)) show = false;
    if (filters.hideZero && t.currentAssets === BigInt(0)) show = false;
    if (filters.onlyIdle && !isIdleRow) show = false;
    if (filters.hideIdle && isIdleRow) show = false;
    if (filters.onlyWithCapacity) {
      if (cap == null || cap <= t.currentAssets) show = false;
    }
    if (editing && filters.onlyEdited && !isEdited) show = false;
    showTarget.set(r.targetIdx, show);
  }

  // Build filtered+sorted list of target indices, then emit their rows (+ children)
  const targetIndices = rows
    .filter((r): r is TargetRow => r.kind === 'target')
    .filter((r) => showTarget.get(r.targetIdx))
    .map((r) => r.targetIdx);

  const sortedTargetIndices = [...targetIndices].sort((a, b) => {
    const ta = targetsWithCaps[a];
    const tb = targetsWithCaps[b];
    const ra = rows.find((r) => r.kind === 'target' && r.targetIdx === a) as TargetRow | undefined;
    const rb = rows.find((r) => r.kind === 'target' && r.targetIdx === b) as TargetRow | undefined;
    if (!ta || !tb || !ra || !rb) return 0;

    switch (filters.sort) {
      case 'allocated-asc':
        return Number(ta.currentAssets) - Number(tb.currentAssets);
      case 'supplyApy-desc':
        return (rb.supplyApy ?? -Infinity) - (ra.supplyApy ?? -Infinity);
      case 'utilization-desc':
        return 0; // targets don't expose utilization
      case 'capacity-desc': {
        const capA = ta.absoluteCapRaw != null ? Number(ta.absoluteCapRaw - ta.currentAssets) : -Infinity;
        const capB = tb.absoluteCapRaw != null ? Number(tb.absoluteCapRaw - tb.currentAssets) : -Infinity;
        return capB - capA;
      }
      case 'name-asc':
        return ra.market.localeCompare(rb.market);
      case 'allocated-desc':
      default:
        return Number(tb.currentAssets) - Number(ta.currentAssets);
    }
  });

  // Emit rows in the new order: each target, followed by its child display rows (if MetaMorpho).
  const rowsToRender: RowType[] = [];
  const rowIdxToTargetChildren = new Map<number, DisplayRow[]>();
  let currentIdx: number | null = null;
  for (const r of rows) {
    if (r.kind === 'target') {
      currentIdx = r.targetIdx;
      rowIdxToTargetChildren.set(currentIdx, []);
    } else if (currentIdx != null) {
      rowIdxToTargetChildren.get(currentIdx)!.push(r);
    }
  }
  for (const idx of sortedTargetIndices) {
    const tr = rows.find((r) => r.kind === 'target' && r.targetIdx === idx) as TargetRow | undefined;
    if (!tr) continue;
    rowsToRender.push(tr);
    for (const child of rowIdxToTargetChildren.get(idx) ?? []) rowsToRender.push(child);
  }

  const plannedSum = resolvedAllocations?.sumAssets ?? BigInt(0);
  const remainingRaw = editing ? totalRawAssets - plannedSum : BigInt(0);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div>
            <CardTitle>Allocations</CardTitle>
            <CardDescription>
              Total: {formatCompactUSD(totalUsd)} ({formatRawTokenAmount(totalRawAssets, vaultDecimals, 2)} {vaultSymbol})
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <AllocationFilters value={filters} onChange={setFilters} editing={editing} showIdleToggles={false} />
            {!editing ? (
              <Button variant="outline" size="sm" onClick={startEditing} className="flex items-center gap-1.5">
                <Pencil className="h-3.5 w-3.5" /> Rebalance
              </Button>
            ) : (
              <div className="flex items-center gap-2">
                <div className="flex gap-0.5 rounded-md border p-0.5">
                  <button
                    onClick={() => { setInputMode('percentage'); setInputValues(targetsWithCaps.map(() => '')); }}
                    className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${inputMode === 'percentage' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                  >%</button>
                  <button
                    onClick={() => { setInputMode('tokens'); setInputValues(targetsWithCaps.map(() => '')); }}
                    className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${inputMode === 'tokens' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                  >{vaultSymbol || 'Tokens'}</button>
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
            decimals={vaultDecimals}
            symbol={vaultSymbol}
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
              {rowsToRender.map((r, i) => {
                if (r.kind === 'target') {
                  const t = targetsWithCaps[r.targetIdx];
                  const currentPct = totalRawAssets > BigInt(0) ? Number(t.currentAssets * BigInt(10000) / totalRawAssets) / 100 : 0;
                  const capRemaining = t.absoluteCapRaw != null
                    ? (t.absoluteCapRaw > t.currentAssets ? t.absoluteCapRaw - t.currentAssets : BigInt(0))
                    : null;

                  return (
                    <TableRow key={`target-${r.targetIdx}`} className="bg-muted/50">
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold">{r.market}</span>
                            {r.isIdle && <Badge variant="outline" className="text-xs">Idle</Badge>}
                            {t.isMetaMorpho && <Badge variant="outline" className="text-xs">MetaMorpho</Badge>}
                          </div>
                          <span className="text-muted-foreground text-xs">
                            {t.isMetaMorpho ? 'Wrapped Vault' : 'Direct Market'}
                          </span>
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
                            {r.allocAssets != null
                              ? `${formatRawTokenAmount(BigInt(r.allocAssets), r.allocDecimals, 2)} ${r.allocSymbol ?? ''}`.trim()
                              : '—'}
                          </span>
                          <span className="text-muted-foreground text-xs">{formatCompactUSD(r.allocated)}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {t.absoluteCapRaw == null ? (
                          <span className="text-muted-foreground text-xs">—</span>
                        ) : (
                          <div className="flex flex-col items-end gap-0.5">
                            <span className="text-xs">
                              {formatRawTokenAmount(t.absoluteCapRaw, t.decimals, 2)}
                            </span>
                            <span className="text-muted-foreground text-[11px]">
                              {capRemaining != null
                                ? `+${formatRawTokenAmount(capRemaining, t.decimals, 2)} free`
                                : ''}
                              {t.relativeCapWad != null && t.relativeCapWad < BigInt('1000000000000000000')
                                ? ` · rel ${(Number(t.relativeCapWad) / 1e16).toFixed(2)}%`
                                : ''}
                            </span>
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right">{`${r.pct.toFixed(2)}%`}</TableCell>
                      {editing && (
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Input
                              type="text"
                              placeholder={inputMode === 'percentage' ? currentPct.toFixed(2) : formatTokenAmount(t.currentAssets, t.decimals, 4)}
                              value={inputValues[r.targetIdx] ?? ''}
                              onChange={(e) => updateInput(r.targetIdx, e.target.value)}
                              className="text-right text-sm w-28 h-8"
                            />
                            <span className="text-xs text-muted-foreground w-6 text-left">
                              {inputMode === 'percentage' ? '%' : t.symbol}
                            </span>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                }

                return (
                  <TableRow key={`display-${i}`}>
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
                          {r.allocAssets != null
                            ? `${formatRawTokenAmount(BigInt(r.allocAssets), r.allocDecimals, 2)} ${r.allocSymbol ?? ''}`.trim()
                            : '—'}
                        </span>
                        <span className="text-muted-foreground text-xs">{formatCompactUSD(r.allocated)}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="text-muted-foreground text-xs">—</span>
                    </TableCell>
                    <TableCell className="text-right">{`${r.pct.toFixed(2)}%`}</TableCell>
                    {editing && <TableCell />}
                  </TableRow>
                );
              })}
              {rowsToRender.length === 0 && (
                <TableRow>
                  <TableCell colSpan={editing ? 9 : 8} className="text-center py-6 text-xs text-muted-foreground">
                    No targets match your filters.
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
                  Balanced and within caps. Deallocations run before allocations via multicall.
                </p>
              </div>
            )}

            {multicallWrite.isSuccess && (
              <div className="flex items-start gap-2 rounded-md bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 p-3">
                <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-green-700 dark:text-green-300">
                  Transaction confirmed! Refresh to see updated allocations.
                </p>
              </div>
            )}

            {multicallWrite.error && (
              <div className="flex items-start gap-2 rounded-md bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 p-3">
                <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-red-700 dark:text-red-300 break-all">
                  {multicallWrite.error.message?.slice(0, 300)}
                </p>
              </div>
            )}

            <TransactionButton
              label={multicallWrite.isLoading ? 'Confirming...' : 'Rebalance'}
              onClick={handleRebalance}
              disabled={!resolvedAllocations?.valid}
              isLoading={multicallWrite.isLoading}
              isSuccess={multicallWrite.isSuccess}
              error={multicallWrite.error}
              txHash={multicallWrite.txHash}
            />

            {multicallWrite.txHash && (
              <p className="text-xs text-muted-foreground break-all">Tx: {multicallWrite.txHash}</p>
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
    ? 'Balanced — every asset is accounted for.'
    : overshoot
    ? `Over-allocated by ${formatRawTokenAmount(absRemaining, decimals, 4)} ${symbol}. Reduce a target.`
    : `Unallocated: ${formatRawTokenAmount(absRemaining, decimals, 4)} ${symbol}. The largest target will absorb dust during dust-adjustment.`;

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
