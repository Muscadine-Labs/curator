'use client';

import { useMemo, useState, useCallback, type ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
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
  keccak256,
} from 'viem';
import {
  formatFullUSD,
  formatPercentage,
  formatRawTokenAmount,
} from '@/lib/format/number';
import {
  getTokenDisplayDecimals,
  resolveAssetDecimals,
} from '@/lib/format/asset-decimals';
import {
  allocationInputWidthCh,
  formatAllocationEditInput,
  formatAllocationTableAmount,
  formatCapDisplayAmount,
  parseHumanTokenInput,
} from '@/lib/format/allocation-display';
import type { V2VaultRiskResponse } from '@/app/api/vaults/v2/[id]/risk/route';
import type { VaultV2GovernanceResponse, CapInfo } from '@/app/api/vaults/v2/[id]/governance/route';
import { isAdapterCap, isMarketCap } from '@/lib/morpho/cap-utils';
import {
  encodeAdapterCapIdData,
  encodeMarketCapIdData,
  encodeMarketParamsData,
} from '@/lib/morpho/v2-id-data';
import {
  AllocationFilters,
  DEFAULT_FILTER_STATE,
  type AllocationFilterState,
} from '@/components/morpho/AllocationFilters';
import {
  applyPlanningDust,
  type DustRecipientChoice,
} from '@/lib/onchain/allocation-dust';
import { DustRecipientSelect } from '@/components/morpho/DustRecipientSelect';
import {
  morphoMarketHref,
  morphoVaultHref,
} from '@/lib/morpho/morpho-app-links';
import { VAULT_VERSION_MAP } from '@/lib/morpho/treasury-statement';
import {
  AllocationPctIndicator,
  AllocationListSection,
  AllocationListShell,
  AllocationPill,
  CuratorAllocationListHeader,
  CuratorAllocationListRow,
  formatMarketPairLabel,
  formatLltvPill,
} from '@/components/morpho/AllocationListView';

interface VaultV2AllocationsProps {
  vaultAddress: string;
  /** Preloaded governance (from parent). Contains caps/timelocks/etc. */
  preloadedData?: VaultV2GovernanceResponse | null;
  /** Preloaded risk data (adapters+markets+allocations). Optional. */
  preloadedRisk?: V2VaultRiskResponse | null;
}

function MorphoAllocationLink({
  href,
  className,
  children,
}: {
  href: string | null | undefined;
  className?: string;
  children: ReactNode;
}) {
  if (!href) {
    return <span className={className}>{children}</span>;
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={className ?? 'font-medium text-foreground hover:text-foreground'}
    >
      {children}
    </a>
  );
}

function formatLiquidityFull(
  row: TargetRow,
  symbol: string,
  decimals: number
): string {
  if (row.liquidityAssets != null) {
    try {
      return formatAllocationTableAmount(BigInt(row.liquidityAssets), symbol, decimals);
    } catch {
      /* fall through */
    }
  }
  if (row.liquidity != null && Number.isFinite(row.liquidity)) {
    return formatFullUSD(row.liquidity, 2);
  }
  return '—';
}

function formatEffAbsCap(
  t: AllocTarget,
  isIdle: boolean
): string {
  if (isIdle || t.absoluteCapRaw == null) return '—';
  return formatCapDisplayAmount(t.absoluteCapRaw, t.symbol, t.decimals);
}

function resolveTargetAssetsFromInput(
  targetIdx: number,
  rawInput: string,
  inputMode: InputMode,
  targets: AllocTarget[],
  totalRaw: bigint
): { assets: bigint; error: string | null } {
  const t = targets[targetIdx];
  const v = rawInput.trim();
  if (!v) {
    return { assets: t.currentAssets, error: null };
  }
  if (inputMode === 'percentage') {
    const pct = parseFloat(v);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      return { assets: t.currentAssets, error: `Invalid percentage for ${t.label}` };
    }
    const assets = (totalRaw * BigInt(Math.round(pct * 1e10))) / BigInt(1e12);
    return { assets, error: null };
  }
  try {
    const assets = parseHumanTokenInput(v, t.symbol, t.decimals);
    if (assets < 0n) {
      return { assets: t.currentAssets, error: `Negative amount for ${t.label}` };
    }
    return { assets, error: null };
  } catch {
    return { assets: t.currentAssets, error: `Invalid number for ${t.label}` };
  }
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
  /** Vault cash not deployed to a strategy adapter — rebalanced via adapter dealloc/alloc. */
  isVaultIdle?: boolean;
  /** Absolute cap in raw token units (null when unknown). */
  absoluteCapRaw: bigint | null;
  /** Relative cap as WAD (1e18 = 100%). Null when unknown. */
  relativeCapWad: bigint | null;
}

type InputMode = 'tokens' | 'percentage';

function parseBigIntOrNull(s: string | number | null | undefined): bigint | null {
  if (s == null) return null;
  try {
    return typeof s === 'bigint' ? s : BigInt(typeof s === 'number' ? Math.floor(s).toString() : s.toString());
  } catch {
    return null;
  }
}

/** Idle cash held in the vault contract (not routed through an adapter). */
type TargetRow = {
  kind: 'target';
  targetIdx: number;
  market: string;
  morphoHref: string | null;
  isIdle: boolean;
  isMorphoBlue: boolean;
  supplyApy: number | null;
  borrowApy: number | null;
  utilization: number | null;
  /** Market or underlying-vault liquidity in USD. */
  liquidity: number | null;
  /** Underlying-vault withdrawable liquidity in raw token units. */
  liquidityAssets: string | null;
  /** Underlying MetaMorpho vault TVL (not V2 allocation). */
  tvlUsd: number | null;
  tvlAssets: string | null;
  allocated: number;
  pct: number;
  allocAssets: string | null;
  allocDecimals: number;
  allocSymbol: string | null;
  /** Morpho Blue LLTV (WAD string from GraphQL). Null for MetaMorpho / idle. */
  lltv: string | number | null;
  collateralSymbol: string | null;
  loanSymbol: string | null;
  wrappedVaultVersion: 'v1' | 'v2' | null;
  /** For filtering */
  searchHaystack: string;
};

type RowType = TargetRow;

type AllocationSection = 'idle' | 'vault' | 'blue';

const ALLOCATION_SECTIONS: { key: AllocationSection; title: string }[] = [
  { key: 'idle', title: 'Idle' },
  { key: 'vault', title: 'V1 Vault' },
  { key: 'blue', title: 'Morpho Blue Market' },
];

function rowSection(r: TargetRow, t: AllocTarget): AllocationSection {
  if (t.isVaultIdle || r.isIdle) return 'idle';
  if (t.isMetaMorpho) return 'vault';
  return 'blue';
}

export function VaultV2Allocations({ vaultAddress, preloadedData, preloadedRisk }: VaultV2AllocationsProps) {
  const { data: fetchedRisk, isLoading, error } = useVaultV2Risk(vaultAddress);
  const { data: fetchedGov } = useVaultV2Governance(vaultAddress);
  const risk = preloadedRisk ?? fetchedRisk;
  const governance = preloadedData ?? fetchedGov;

  const capByIdHash = useMemo(() => {
    const map = new Map<string, CapInfo>();
    for (const cap of governance?.caps ?? []) {
      // Build idHash for each cap based on its kind.
      if (isAdapterCap(cap) && cap.adapterAddress) {
        const h = keccak256(encodeAdapterCapIdData(cap.adapterAddress));
        map.set(h.toLowerCase(), cap);
      }
      if (isMarketCap(cap) && cap.marketKey) {
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
      if (t.isVaultIdle) return null;
      const byHash = capByIdHash.get(t.capIdHash.toLowerCase());
      if (byHash) return byHash;
      if (t.isMetaMorpho) {
        const byAdapter = (governance?.caps ?? []).find(
          (c) =>
            c.adapterAddress?.toLowerCase() === t.adapterAddress.toLowerCase() && isAdapterCap(c)
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

  const { rows, totalUsd, targets, totalRawAssets, vaultDecimals, vaultDisplayDecimals, vaultSymbol } =
    useMemo(() => {
    if (!risk) {
      return {
        rows: [] as RowType[],
        totalUsd: 0,
        targets: [] as AllocTarget[],
        totalRawAssets: BigInt(0),
        vaultDecimals: 18,
        vaultDisplayDecimals: 6,
        vaultSymbol: '',
      };
    }

    const idleUsd = risk.idleAssetsUsd ?? 0;
    let idleRaw = BigInt(0);
    if (risk.idleAssets) {
      try {
        idleRaw = BigInt(risk.idleAssets);
      } catch {
        /* ignore */
      }
    }

    const totalUsd = (risk.totalAdapterAssetsUsd ?? 0) + idleUsd;
    const va = risk.vaultAsset;
    const dec = resolveAssetDecimals(va?.symbol, va?.decimals);
    const displayDec = getTokenDisplayDecimals(va?.symbol, dec);
    const sym = va?.symbol ?? '';
    const adapterList = (risk.adapters ?? []).slice().sort((a, b) => (b.allocationUsd ?? 0) - (a.allocationUsd ?? 0));

    const rows: RowType[] = [];
    const targets: AllocTarget[] = [];
    let totalRaw = BigInt(0);

    for (const adapter of adapterList) {
      const isMetaMorpho = adapter.adapterType === 'MetaMorphoAdapter';

      if (isMetaMorpho) {
        const adapterPct = totalUsd > 0 ? ((adapter.allocationUsd ?? 0) / totalUsd) * 100 : 0;
        const allocAssets = adapter.allocationAssets ?? null;
        const allocDec = dec;
        const allocSym = sym;

        const tIdx = targets.length;
        let rawAssets = BigInt(0);
        if (allocAssets) { try { rawAssets = BigInt(allocAssets); } catch { /* */ } }
        totalRaw += rawAssets;

        const adapterDataHex = '0x' as Hex;
        const adapterIdData = encodeAdapterCapIdData(adapter.adapterAddress);
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

        const underlying = adapter.underlyingVaultStats;
        const underlyingAddr = adapter.underlyingVaultAddress?.toLowerCase();
        const wrappedVersion = underlyingAddr ? VAULT_VERSION_MAP[underlyingAddr] ?? null : null;
        const displayName = adapter.adapterLabel || 'MetaMorpho';

        rows.push({
          kind: 'target',
          targetIdx: tIdx,
          market: displayName,
          morphoHref: morphoVaultHref(adapter.underlyingVaultAddress),
          isIdle: false,
          isMorphoBlue: false,
          supplyApy: underlying?.netApy ?? null,
          borrowApy: null,
          utilization: null,
          liquidity: underlying?.liquidityUsd ?? null,
          liquidityAssets: underlying?.liquidityUnderlying ?? null,
          tvlUsd: underlying?.totalAssetsUsd ?? null,
          tvlAssets: underlying?.totalAssets ?? null,
          allocated: adapter.allocationUsd ?? 0,
          pct: adapterPct,
          allocAssets,
          allocDecimals: allocDec,
          allocSymbol: allocSym,
          lltv: null,
          collateralSymbol: allocSym || null,
          loanSymbol: null,
          wrappedVaultVersion: wrappedVersion,
          searchHaystack: `${displayName} ${allocSym ?? ''} metamorpho`.toLowerCase(),
        });
      } else {
        const sortedMarkets = (adapter.markets ?? [])
          .slice()
          .sort((a, b) => (b.allocationUsd ?? 0) - (a.allocationUsd ?? 0));
        for (const m of sortedMarkets) {
          const col = m.market?.collateralAsset?.symbol;
          const loan = m.market?.loanAsset?.symbol;
          const label = formatMarketPairLabel(col, loan);
          const allocAssets = m.allocationAssets ?? null;
          const allocDec = m.market?.loanAsset?.decimals ?? dec;
          const allocSym = m.market?.loanAsset?.symbol ?? sym;
          const mktPct = totalUsd > 0 ? ((m.allocationUsd ?? 0) / totalUsd) * 100 : 0;

          let rawAssets = BigInt(0);
          if (allocAssets) { try { rawAssets = BigInt(allocAssets); } catch { /* */ } }
          totalRaw += rawAssets;

          const data = m.market ? encodeMarketParamsData(m.market) : ('0x' as Hex);
          const capIdData = m.market
            ? encodeMarketCapIdData(adapter.adapterAddress, m.market)
            : data;
          const idHash = keccak256(capIdData);

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
            morphoHref: morphoMarketHref(m.market?.uniqueKey),
            isIdle: !m.market?.lltv,
            isMorphoBlue: true,
            supplyApy: m.market?.state?.supplyApy ?? null,
            borrowApy: m.market?.state?.borrowApy ?? null,
            utilization: m.market?.state?.utilization ?? null,
            liquidity: m.market?.state?.liquidityAssetsUsd ?? null,
            liquidityAssets: null,
            tvlUsd: null,
            tvlAssets: null,
            allocated: m.allocationUsd ?? 0,
            pct: mktPct,
            allocAssets,
            allocDecimals: allocDec,
            allocSymbol: allocSym,
            lltv: m.market?.lltv ?? null,
            collateralSymbol: col ?? null,
            loanSymbol: loan ?? null,
            wrappedVaultVersion: null,
            searchHaystack: `${label} ${allocSym ?? ''} ${formatLltvPill(m.market?.lltv ?? null) ?? ''} morpho blue`.toLowerCase(),
          });
        }
      }
    }

    const idlePct = totalUsd > 0 ? (idleUsd / totalUsd) * 100 : 0;
    const idleTIdx = targets.length;
    totalRaw += idleRaw;

    targets.push({
      label: 'Idle',
      adapterAddress: '0x0000000000000000000000000000000000000000',
      adapterType: 'Idle',
      data: '0x' as Hex,
      capIdHash: '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex,
      currentAssets: idleRaw,
      currentUsd: idleUsd,
      decimals: dec,
      symbol: sym,
      isMetaMorpho: false,
      isVaultIdle: true,
      absoluteCapRaw: null,
      relativeCapWad: null,
    });

    rows.push({
      kind: 'target',
      targetIdx: idleTIdx,
      market: 'Idle',
      morphoHref: null,
      isIdle: true,
      isMorphoBlue: false,
      supplyApy: null,
      borrowApy: null,
      utilization: null,
      liquidity: null,
      liquidityAssets: null,
      tvlUsd: null,
      tvlAssets: null,
      allocated: idleUsd,
      pct: idlePct,
      allocAssets: risk.idleAssets ?? null,
      allocDecimals: dec,
      allocSymbol: sym,
      lltv: null,
      collateralSymbol: sym || null,
      loanSymbol: null,
      wrappedVaultVersion: null,
      searchHaystack: 'idle',
    });

    return {
      rows,
      totalUsd,
      targets,
      totalRawAssets: totalRaw,
      vaultDecimals: dec,
      vaultDisplayDecimals: displayDec,
      vaultSymbol: sym,
    };
  }, [risk]);

  // Attach caps to each target now that `targets` and `capByIdHash` are known.
  const targetsWithCaps: AllocTarget[] = useMemo(() => {
    return targets.map((t) => {
      if (t.isVaultIdle) {
        return { ...t, absoluteCapRaw: null, relativeCapWad: null };
      }
      const marketKey =
        !t.isMetaMorpho && !t.isVaultIdle
          ? (risk?.adapters ?? [])
              .flatMap((a) => a.markets ?? [])
              .find((m) => {
                if (!m.market) return false;
                const data = encodeMarketParamsData(m.market);
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
  const [inputMode, setInputMode] = useState<InputMode>('tokens');
  const [inputValues, setInputValues] = useState<string[]>([]);
  const [filters, setFilters] = useState<AllocationFilterState>(DEFAULT_FILTER_STATE);
  /** Where unallocated remainder goes: 'auto' = implicit Idle, or a target index. */
  const [dustRecipientKey, setDustRecipientKey] = useState<DustRecipientChoice>('auto');
  const multicallWrite = useVaultWrite();

  const startEditing = useCallback(() => {
    setInputMode('tokens');
    setInputValues(targetsWithCaps.map(() => ''));
    setDustRecipientKey('auto');
    setEditing(true);
  }, [targetsWithCaps]);

  const cancelEditing = useCallback(() => {
    setEditing(false);
    multicallWrite.reset();
  }, [multicallWrite]);

  const updateInput = useCallback((idx: number, val: string) => {
    setInputValues((prev) => prev.map((v, i) => (i === idx ? val : v)));
  }, []);

  const parseInputToRaw = useCallback(
    (idx: number, val: string): bigint => {
      return resolveTargetAssetsFromInput(
        idx,
        val,
        inputMode,
        targetsWithCaps,
        totalRawAssets
      ).assets;
    },
    [inputMode, targetsWithCaps, totalRawAssets]
  );

  const formatRawAsInput = useCallback(
    (raw: bigint, t: AllocTarget): string => {
      if (inputMode === 'percentage') {
        const pct =
          totalRawAssets > BigInt(0)
            ? Number((raw * BigInt(10000)) / totalRawAssets) / 100
            : 0;
        return pct.toFixed(2);
      }
      return formatAllocationEditInput(raw, t.symbol, t.decimals);
    },
    [inputMode, totalRawAssets]
  );

  const setRowZero = useCallback(
    (targetIdx: number) => {
      updateInput(targetIdx, '0');
    },
    [updateInput]
  );

  const setRowMax = useCallback(
    (targetIdx: number) => {
      setInputValues((prev) => {
        const values = prev.length === targetsWithCaps.length ? prev : targetsWithCaps.map(() => '');
        let others = BigInt(0);
        for (let j = 0; j < targetsWithCaps.length; j++) {
          if (j === targetIdx) continue;
          others += resolveTargetAssetsFromInput(
            j,
            values[j] ?? '',
            inputMode,
            targetsWithCaps,
            totalRawAssets
          ).assets;
        }
        let max = totalRawAssets > others ? totalRawAssets - others : BigInt(0);
        const t = targetsWithCaps[targetIdx];
        if (!t.isVaultIdle && t.absoluteCapRaw != null && max > t.absoluteCapRaw) {
          max = t.absoluteCapRaw;
        }
        if (!t.isVaultIdle && t.relativeCapWad != null && totalRawAssets > BigInt(0)) {
          const wad = BigInt('1000000000000000000');
          const maxRel = (totalRawAssets * t.relativeCapWad) / wad;
          if (max > maxRel) max = maxRel;
        }
        const next = [...values];
        next[targetIdx] = formatRawAsInput(max, t);
        return next;
      });
    },
    [formatRawAsInput, inputMode, targetsWithCaps, totalRawAssets]
  );

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
      const resolved = resolveTargetAssetsFromInput(
        i,
        v,
        inputMode,
        targetsWithCaps,
        totalRawAssets
      );
      if (resolved.error) {
        errorMsg = resolved.error;
        break;
      }
      results.push({
        target: t,
        assets: resolved.assets,
        current: t.currentAssets,
      });
    }

    const partialInputSum = results.reduce((s, r) => s + r.assets, BigInt(0));

    if (errorMsg) {
      return {
        valid: false as const,
        error: errorMsg,
        results: [] as Result[],
        inputSum: partialInputSum,
        sumAssets: partialInputSum,
        dustDiff: BigInt(0),
        dustRecipientIdx: null as number | null,
      };
    }
    if (results.length !== targetsWithCaps.length) {
      return {
        valid: false as const,
        error: 'Missing entries',
        results: [] as Result[],
        inputSum: BigInt(0),
        sumAssets: BigInt(0),
        dustDiff: BigInt(0),
        dustRecipientIdx: null as number | null,
      };
    }

    const inputSum = results.reduce((s, r) => s + r.assets, BigInt(0));
    const diff = totalRawAssets - inputSum;
    const overshoot = diff < BigInt(0);
    const idleIdx = results.findIndex((r) => r.target.isVaultIdle);
    const allRowsEdited = modified.length === targetsWithCaps.length;

    let adjustedResults = results;
    let dustDiff = BigInt(0);
    let dustRecipientIdx: number | null = null;

    // Explicit dust recipient: curator picked a strategy target to absorb the
    // unallocated remainder. Cap validation below still applies to the
    // inflated target. With 'auto' the remainder stays implicit Idle —
    // never auto-pushed onto a strategy target.
    const explicitRecipientIdx =
      dustRecipientKey !== 'auto' ? Number.parseInt(dustRecipientKey, 10) : NaN;
    if (
      !overshoot &&
      diff !== BigInt(0) &&
      Number.isInteger(explicitRecipientIdx) &&
      explicitRecipientIdx >= 0 &&
      explicitRecipientIdx < results.length &&
      !results[explicitRecipientIdx].target.isVaultIdle
    ) {
      const dustResult = applyPlanningDust(
        results,
        totalRawAssets,
        explicitRecipientIdx,
        (r) => r.assets,
        (r, assets) => ({ ...r, assets })
      );
      if (!dustResult.error) {
        adjustedResults = dustResult.items;
        dustDiff = dustResult.diff;
        dustRecipientIdx = explicitRecipientIdx;
      }
    } else if (
      // Full % rebalance only: nudge sub-token rounding onto idle. Never inflate a strategy target.
      !overshoot &&
      diff !== BigInt(0) &&
      inputMode === 'percentage' &&
      allRowsEdited &&
      idleIdx >= 0
    ) {
      const dustResult = applyPlanningDust(
        results,
        totalRawAssets,
        idleIdx,
        (r) => r.assets,
        (r, assets) => ({ ...r, assets })
      );
      if (!dustResult.error) {
        adjustedResults = dustResult.items;
        dustDiff = dustResult.diff;
        dustRecipientIdx = idleIdx;
      }
    }

    if (adjustedResults.some((r) => r.assets < BigInt(0))) {
      return {
        valid: false as const,
        error: 'Allocation would go negative',
        results: [] as Result[],
        inputSum,
        sumAssets: inputSum,
        dustDiff: BigInt(0),
        dustRecipientIdx: null as number | null,
      };
    }

    if (overshoot) {
      return {
        valid: false as const,
        error: `Over-allocated by ${formatRawTokenAmount(-diff, vaultDecimals, vaultDisplayDecimals)} ${vaultSymbol}. Reduce a target.`,
        results: adjustedResults,
        inputSum,
        sumAssets: inputSum,
        dustDiff,
        dustRecipientIdx,
      };
    }

    // Cap validation (strategy adapters only — idle has no on-chain cap)
    for (const r of adjustedResults) {
      if (r.target.isVaultIdle) continue;
      if (r.assets <= r.current) continue;
      const t = r.target;
      if (t.absoluteCapRaw != null && r.assets > t.absoluteCapRaw) {
        return {
          valid: false as const,
          error: `${t.label}: allocation exceeds absolute cap (${formatRawTokenAmount(t.absoluteCapRaw, resolveAssetDecimals(t.symbol, t.decimals), getTokenDisplayDecimals(t.symbol, t.decimals))} ${t.symbol}).`,
          results: [] as Result[],
          inputSum,
          sumAssets: inputSum,
          dustDiff,
          dustRecipientIdx,
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
            inputSum,
            sumAssets: inputSum,
            dustDiff,
            dustRecipientIdx,
          };
        }
      }
    }

    // Only strategy-adapter deltas produce on-chain calls; an idle-only edit
    // has nothing to submit (idle never appears in allocate/deallocate calldata).
    const anyChanged = adjustedResults.some(
      (r) => !r.target.isVaultIdle && r.assets !== r.current
    );
    if (!anyChanged) {
      return {
        valid: false as const,
        error: null,
        results: adjustedResults,
        inputSum,
        sumAssets: inputSum,
        dustDiff,
        dustRecipientIdx,
      };
    }

    return {
      valid: true as const,
      error: null,
      results: adjustedResults,
      inputSum,
      sumAssets: inputSum,
      dustDiff,
      dustRecipientIdx,
    };
  }, [editing, inputValues, targetsWithCaps, inputMode, totalRawAssets, vaultDecimals, vaultDisplayDecimals, vaultSymbol, dustRecipientKey]);

  const handleRebalance = useCallback(() => {
    if (!resolvedAllocations?.valid) return;

    const deallocCalls: Hex[] = [];
    const allocCalls: Hex[] = [];

    for (const r of resolvedAllocations.results) {
      if (r.target.isVaultIdle) continue;
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
      // Idle is never a direct allocate/deallocate target — skip it here.
      const r = resolvedAllocations.results.find(
        (r) => !r.target.isVaultIdle && r.assets !== r.current
      )!;
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

  const getRowPercent = useCallback(
    (targetIdx: number): number => {
      const t = targetsWithCaps[targetIdx];
      if (!t) return 0;
      if (!editing) {
        return totalRawAssets > BigInt(0)
          ? Number((t.currentAssets * BigInt(10000)) / totalRawAssets) / 100
          : 0;
      }
      const v = inputValues[targetIdx]?.trim() ?? '';
      if (!v) {
        return totalRawAssets > BigInt(0)
          ? Number((t.currentAssets * BigInt(10000)) / totalRawAssets) / 100
          : 0;
      }
      if (inputMode === 'percentage') {
        const pct = parseFloat(v);
        return Number.isFinite(pct) ? pct : 0;
      }
      const raw = parseInputToRaw(targetIdx, v);
      return totalRawAssets > BigInt(0)
        ? Number((raw * BigInt(10000)) / totalRawAssets) / 100
        : 0;
    },
    [editing, inputMode, inputValues, parseInputToRaw, targetsWithCaps, totalRawAssets]
  );

  if (!preloadedRisk && isLoading) {
    return (
      <Card>
        <CardHeader><CardTitle>Allocation</CardTitle></CardHeader>
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
        <CardHeader><CardTitle>Allocation</CardTitle></CardHeader>
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
        <CardHeader><CardTitle>Allocation</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-slate-500 dark:text-slate-400">No allocations yet.</p>
        </CardContent>
      </Card>
    );
  }

  // --- Filtering & sorting -------------------------------------------------
  const search = filters.search.trim().toLowerCase();

  // A target is "delisted" when it holds nothing and has no active cap
  // (absolute and relative both absent/zero) — the vault can no longer
  // allocate to it, so it should not appear as a rebalance target.
  // Zero-allocation markets that still have a live cap remain visible.
  const govLoaded = (governance?.caps?.length ?? 0) > 0;
  const isDelistedTarget = (t: AllocTarget): boolean =>
    govLoaded &&
    !t.isVaultIdle &&
    t.currentAssets === BigInt(0) &&
    (t.absoluteCapRaw == null || t.absoluteCapRaw === BigInt(0)) &&
    (t.relativeCapWad == null || t.relativeCapWad === BigInt(0));

  // Map target index -> whether it should be shown
  const showTarget = new Map<number, boolean>();
  for (const r of rows) {
    const t = targetsWithCaps[r.targetIdx];
    if (!t) { showTarget.set(r.targetIdx, false); continue; }
    if (isDelistedTarget(t)) { showTarget.set(r.targetIdx, false); continue; }

    const entryVal = editing ? inputValues[r.targetIdx] ?? '' : '';
    const isEdited = entryVal.trim() !== '';
    const isIdleRow = Boolean(t.isVaultIdle);
    const cap = t.absoluteCapRaw;

    let show = true;
    if (filters.onlyIdle && !isIdleRow) show = false;
    if (search && !r.searchHaystack.includes(search)) show = false;
    if (filters.hideZero && t.currentAssets === BigInt(0)) show = false;
    if (filters.hideIdle && isIdleRow) show = false;
    if (filters.onlyWithCapacity) {
      if (t.isVaultIdle || cap == null || cap <= t.currentAssets) show = false;
    }
    if (editing && filters.onlyEdited && !isEdited) show = false;
    showTarget.set(r.targetIdx, show);
  }

  const targetIndices = rows
    .filter((r) => showTarget.get(r.targetIdx))
    .map((r) => r.targetIdx);

  const sortedTargetIndices = [...targetIndices].sort((a, b) => {
    const ta = targetsWithCaps[a];
    const tb = targetsWithCaps[b];
    const ra = rows.find((r) => r.targetIdx === a);
    const rb = rows.find((r) => r.targetIdx === b);
    if (!ta || !tb || !ra || !rb) return 0;

    switch (filters.sort) {
      case 'allocated-asc':
        return Number(ta.currentAssets) - Number(tb.currentAssets);
      case 'supplyApy-desc':
        return (rb.supplyApy ?? -Infinity) - (ra.supplyApy ?? -Infinity);
      case 'utilization-desc':
        return (rb.utilization ?? -Infinity) - (ra.utilization ?? -Infinity);
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

  const rowsToRender: RowType[] = [];
  for (const idx of sortedTargetIndices) {
    const tr = rows.find((r) => r.targetIdx === idx);
    if (tr) rowsToRender.push(tr);
  }

  const plannedSum = resolvedAllocations?.inputSum ?? BigInt(0);
  const remainingRaw = editing ? totalRawAssets - plannedSum : BigInt(0);
  const hasEditingInputs = editing && inputValues.some((v) => v.trim() !== '');

  // Strategy targets the curator can route unallocated remainder to ('auto' = Idle).
  const dustOptions = targetsWithCaps
    .map((t, idx) => ({ id: String(idx), label: t.label, isVaultIdle: t.isVaultIdle }))
    .filter((o) => !o.isVaultIdle)
    .map(({ id, label }) => ({ id, label }));

  const dustRecipientLabel =
    dustRecipientKey !== 'auto'
      ? targetsWithCaps[Number.parseInt(dustRecipientKey, 10)]?.label ?? null
      : null;

  const sectionedRows = ALLOCATION_SECTIONS.map((section) => ({
    ...section,
    rows: rowsToRender.filter((r) => {
      const t = targetsWithCaps[r.targetIdx];
      return t && rowSection(r, t) === section.key;
    }),
  })).filter((section) => section.rows.length > 0);

  const renderAllocationRow = (r: TargetRow) => {
    const t = targetsWithCaps[r.targetIdx];
    const lltvPill = formatLltvPill(r.lltv);
    const isIdle = Boolean(t.isVaultIdle);

    const allocationAmount = formatAllocationTableAmount(
      r.allocAssets != null ? BigInt(r.allocAssets) : t.currentAssets,
      r.allocSymbol ?? t.symbol,
      r.allocDecimals
    );

    const inputWidthCh = allocationInputWidthCh(t.symbol, t.decimals);

    const rate = isIdle ? '—' : formatOrDash(scalePercent(r.supplyApy));

    const utilizationCell = filters.columns.utilization
      ? formatOrDash(scalePercent(r.utilization))
      : '—';

    const percentAllocated = (
      <AllocationPctIndicator pct={getRowPercent(r.targetIdx)} />
    );

    return (
      <CuratorAllocationListRow
        key={`target-${r.targetIdx}`}
        editing={editing}
        className={isIdle ? 'bg-muted/30' : undefined}
        name={
          isIdle ? (
            r.market
          ) : (
            <MorphoAllocationLink href={r.morphoHref}>{r.market}</MorphoAllocationLink>
          )
        }
        tags={lltvPill ? <AllocationPill>{lltvPill}</AllocationPill> : undefined}
        allocationAmount={allocationAmount}
        effectiveCap={formatEffAbsCap(t, isIdle)}
        rate={rate}
        liquidity={formatLiquidityFull(r, t.symbol, t.decimals)}
        utilization={utilizationCell}
        percentAllocated={percentAllocated}
        targetCell={
          editing ? (
            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 px-2.5 text-xs"
                onClick={() => setRowZero(r.targetIdx)}
              >
                Zero
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 px-2.5 text-xs"
                onClick={() => setRowMax(r.targetIdx)}
              >
                Max
              </Button>
              <Input
                type="text"
                inputMode="decimal"
                placeholder={formatAllocationEditInput(t.currentAssets, t.symbol, t.decimals)}
                value={inputValues[r.targetIdx] ?? ''}
                onChange={(e) => updateInput(r.targetIdx, e.target.value)}
                className="h-9 text-right font-mono text-sm tabular-nums"
                style={{ width: `${inputWidthCh}ch` }}
              />
              <span className="w-10 shrink-0 text-left text-xs text-muted-foreground">
                {inputMode === 'percentage' ? '%' : t.symbol}
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
                ? formatFullUSD(totalUsd, 2)
                : `${formatRawTokenAmount(totalRawAssets, vaultDecimals, vaultDisplayDecimals)} ${vaultSymbol}`}
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <AllocationFilters value={filters} onChange={setFilters} editing={editing} />
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
        {editing && hasEditingInputs && (
          <div className="mb-3 space-y-2">
            <RemainingBanner
              totalRaw={totalRawAssets}
              plannedRaw={plannedSum}
              remainingRaw={remainingRaw}
              decimals={vaultDecimals}
              symbol={vaultSymbol}
              dustDiff={resolvedAllocations?.dustDiff ?? BigInt(0)}
              implicitIdle
              dustRecipientLabel={dustRecipientLabel}
              parseError={resolvedAllocations?.error ?? null}
            />
            <DustRecipientSelect
              value={dustRecipientKey}
              onChange={setDustRecipientKey}
              options={dustOptions}
              autoLabel="Idle (default)"
            />
          </div>
        )}

        <AllocationListShell>
          <CuratorAllocationListHeader editing={editing} />
          {rowsToRender.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-muted-foreground">
              No targets match your filters.
            </div>
          ) : (
            sectionedRows.map((section) => (
              <AllocationListSection key={section.key} title={section.title}>
                {section.rows.map((r) => renderAllocationRow(r))}
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
  dustDiff = BigInt(0),
  implicitIdle = false,
  dustRecipientLabel = null,
  parseError = null,
}: {
  totalRaw: bigint;
  plannedRaw: bigint;
  remainingRaw: bigint;
  decimals: number;
  symbol: string;
  dustDiff?: bigint;
  implicitIdle?: boolean;
  dustRecipientLabel?: string | null;
  parseError?: string | null;
}) {
  const isBalanced = remainingRaw === BigInt(0) && !parseError;
  const overshoot = remainingRaw < BigInt(0);
  const absRemaining = overshoot ? -remainingRaw : remainingRaw;
  const tinyDust =
    dustDiff !== BigInt(0) &&
    (dustDiff < BigInt(0) ? -dustDiff : dustDiff) <= parseUnits('0.01', decimals);

  const tone = parseError
    ? 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800 text-red-800 dark:text-red-200'
    : isBalanced
    ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
    : overshoot
    ? 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800 text-red-800 dark:text-red-200'
    : 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200';

  const label = parseError
    ? parseError
    : isBalanced
    ? tinyDust
      ? `Balanced — ${formatAllocationTableAmount(dustDiff, symbol, decimals)} rounding applied to ${dustRecipientLabel ?? 'Idle'}.`
      : 'Balanced — every asset is accounted for.'
    : overshoot
    ? `Over-allocated by ${formatAllocationTableAmount(absRemaining, symbol, decimals)}. Reduce a target.`
    : dustRecipientLabel
    ? `${formatAllocationTableAmount(absRemaining, symbol, decimals)} will go to ${dustRecipientLabel} after rebalance.`
    : implicitIdle
    ? `${formatAllocationTableAmount(absRemaining, symbol, decimals)} will move to Idle after rebalance.`
    : `Unallocated: ${formatAllocationTableAmount(absRemaining, symbol, decimals)}.`;

  const fmt = (v: bigint) => formatAllocationTableAmount(v, symbol, decimals);

  return (
    <div className={`mb-3 rounded-md border p-3 text-xs ${tone}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>{label}</span>
        <span className="font-mono text-sm tabular-nums">
          planned {fmt(plannedRaw)} / {fmt(totalRaw)}
        </span>
      </div>
    </div>
  );
}
