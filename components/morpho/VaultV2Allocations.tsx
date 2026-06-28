'use client';

import Link from 'next/link';
import { useMemo, useState, useCallback, useEffect, useRef, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertTriangle, CheckCircle2, Loader2, Pencil } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useVaultV2Risk } from '@/lib/hooks/useVaultV2Risk';
import {
  useVaultV2Governance,
  vaultV2GovernanceQueryKey,
} from '@/lib/hooks/useVaultV2Governance';
import { useVaultWrite } from '@/lib/hooks/useVaultWrite';
import { TransactionButton } from '@/components/TransactionButton';
import { TxPreviewDialog } from '@/components/morpho/TxPreviewDialog';
import { buildAllocationRebalancePreview } from '@/lib/morpho/tx-preview';
import type { TxPreview } from '@/lib/morpho/tx-preview';
import { queueVaultRebalanceInSafe } from '@/lib/safe/queue-vault-write';
import { useCuratorSafeApps } from '@/lib/safe/safe-apps-context';
import { resolveAllocationWriteMode } from '@/lib/safe/vault-role-match';
import { v2WriteConfigs } from '@/lib/onchain/vault-writes';
import type { Address, Hex } from 'viem';
import {
  BaseError,
  getAddress,
  keccak256,
  parseUnits,
} from 'viem';
import {
  formatFullUSD,
  formatPercentage,
  formatRawTokenAmount,
} from '@/lib/format/number';
import { formatCapRelative } from '@/lib/morpho/v2-cap-format';
import {
  getTokenDisplayDecimals,
  resolveAssetDecimals,
} from '@/lib/format/asset-decimals';
import {
  allocationInputWidthCh,
  formatAllocationAmount,
  formatAllocationEditInput,
  formatAllocationEditInputExact,
  formatAllocationTableAmount,
  formatCapDisplayAmount,
  readMarketLiquidity,
  parseHumanTokenInput,
  clampDeallocateAmount,
} from '@/lib/format/allocation-display';
import { formatLiquidityCell } from '@/components/morpho/FormatLiquidityCell';
import { usePersistedAllocationFilters } from '@/lib/hooks/usePersistedAllocationFilters';
import { clearAllocationFilters } from '@/lib/allocation/allocation-filters-storage';
import type { V2VaultRiskResponse } from '@/app/api/vaults/[id]/risk/route';
import type { VaultV2GovernanceResponse, CapInfo } from '@/app/api/vaults/[id]/governance/route';
import { isAdapterCap, isMarketCap } from '@/lib/morpho/cap-utils';
import { collectMorphoBlueMarketEntries } from '@/lib/morpho/v2-allocation-targets';
import {
  encodeAdapterCapIdData,
  encodeMarketCapIdData,
  encodeMarketParamsData,
} from '@/lib/morpho/v2-id-data';
import {
  AllocationFilters,
  type AllocationFilterState,
} from '@/components/morpho/AllocationFilters';
import {
  applyPlanningDust,
  type DustRecipientChoice,
} from '@/lib/onchain/allocation-dust';
import {
  buildRebalanceMulticallData,
  clampPlanToFundableIdle,
  CLAMP_TO_FUNDABLE_WARNING,
  computeDeployableIdle,
  computeIdleTargetFromStrategyPlan,
  finalizeRebalancePlan,
  maxTargetFromIdleDeploy,
  percentInputToRaw,
  rawToPercentInput,
  trimPlanToVaultTotal,
  validateIdleFunding,
  type RebalancePlanRow,
} from '@/lib/onchain/v2-rebalance-plan';
import { vaultV2Abi } from '@/lib/onchain/abis';
import { BASE_CHAIN_ID } from '@/lib/constants';
import { useAccount, usePublicClient } from 'wagmi';
import { DustRecipientSelect } from '@/components/morpho/DustRecipientSelect';
import {
  curatorBlueMarketHref,
  marketKeyFromGraphQL,
} from '@/lib/morpho/morpho-app-links';
import {
  AllocationPctIndicator,
  AllocationListSection,
  AllocationListShell,
  AllocationPill,
  CuratorAllocationListHeader,
  CuratorAllocationListRow,
  getCuratorVisibleColumns,
  formatMarketPairLabel,
  formatLltvPill,
} from '@/components/morpho/AllocationListView';
import { VaultV2LiquidityAdapter } from '@/components/morpho/VaultV2LiquidityAdapter';

interface VaultV2AllocationsProps {
  vaultAddress: string;
  chainId: number;
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
  const linkClass = className ?? 'font-medium text-foreground hover:text-foreground';
  if (href.startsWith('/')) {
    return (
      <Link href={href} className={linkClass}>
        {children}
      </Link>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={linkClass}
    >
      {children}
    </a>
  );
}

function compareBigIntDesc(a: bigint, b: bigint): number {
  if (a === b) return 0;
  return a > b ? -1 : 1;
}

function compareBigIntAsc(a: bigint, b: bigint): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function formatWriteError(error: unknown): string {
  if (error instanceof BaseError) {
    const msg = error.shortMessage || error.message;
    if (msg.includes('0xace2a47e') || msg.toLowerCase().includes('transferreverted')) {
      return 'Allocate failed: vault could not transfer tokens (not enough idle cash at that step). Zero other markets first, then Max — or reduce the target amount.';
    }
    return msg;
  }
  if (error instanceof Error) {
    if (error.message.includes('0xace2a47e')) {
      return 'Allocate failed: vault could not transfer tokens (not enough idle cash at that step). Zero other markets first, then Max — or reduce the target amount.';
    }
    return error.message;
  }
  return 'Transaction failed.';
}

/** Headroom under absolute and relative caps (if known). */
function hasRemainingCapacity(t: AllocTarget, totalRaw: bigint): boolean {
  if (t.isVaultIdle) return false;
  let hasHeadroom = false;
  if (t.absoluteCapRaw != null && t.absoluteCapRaw > t.currentAssets) {
    hasHeadroom = true;
  }
  if (t.relativeCapWad != null && totalRaw > BigInt(0)) {
    const wad = BigInt('1000000000000000000');
    const maxRel = (totalRaw * t.relativeCapWad) / wad;
    if (maxRel > t.currentAssets) hasHeadroom = true;
  }
  return hasHeadroom;
}

function formatEffRelCap(t: AllocTarget, isIdle: boolean): string {
  if (isIdle || t.relativeCapWad == null) return '—';
  return formatCapRelative(t.relativeCapWad.toString());
}

function formatRowAllocationCell(
  r: TargetRow,
  t: AllocTarget,
  filters: AllocationFilterState
): string {
  const raw = r.allocAssets != null ? BigInt(r.allocAssets) : t.displayAssets;
  if (filters.displayMode === 'percent') {
    return `${r.pct.toFixed(2)}%`;
  }
  return formatAllocationAmount(
    filters.amountUnit,
    r.allocated,
    raw,
    r.allocSymbol ?? t.symbol,
    r.allocDecimals
  );
}

function formatRowCapCell(
  t: AllocTarget,
  isIdle: boolean,
  filters: AllocationFilterState
): string {
  if (isIdle) return '—';
  if (filters.displayMode === 'percent' && t.relativeCapWad != null) {
    return formatCapRelative(t.relativeCapWad.toString());
  }
  return formatEffAbsCap(t, isIdle);
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
    const parsed = percentInputToRaw(v, totalRaw);
    if (parsed.error) {
      return { assets: t.currentAssets, error: `Invalid percentage for ${t.label}` };
    }
    return { assets: parsed.assets, error: null };
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

type AdapterType = 'MorphoMarketV1Adapter' | string;

/** One allocation target that can be individually allocated/deallocated. */
interface AllocTarget {
  label: string;
  adapterAddress: string;
  adapterType: AdapterType;
  /** ABI-encoded data param for allocate/deallocate (encoded market params). */
  data: Hex;
  /** keccak256(data) — the primary cap id used by the vault. */
  capIdHash: Hex;
  /** On-chain booked allocation(id) — write planning baseline. */
  currentAssets: bigint;
  /** Economic position incl. accrued market interest — UI display. */
  displayAssets: bigint;
  currentUsd: number;
  decimals: number;
  symbol: string;
  /** Vault cash not deployed to a strategy adapter — rebalanced via adapter dealloc/alloc. */
  isVaultIdle?: boolean;
  /** Absolute cap in raw token units (null when unknown). */
  absoluteCapRaw: bigint | null;
  /** Relative cap as WAD (1e18 = 100%). Null when unknown. */
  relativeCapWad: bigint | null;
}

function mapResultsToPlanRows(
  results: ReadonlyArray<{ target: AllocTarget; assets: bigint; current: bigint }>
): RebalancePlanRow[] {
  return results.map((r) => ({
    target: {
      label: r.target.label,
      adapterAddress: r.target.adapterAddress,
      data: r.target.data,
      capIdHash: r.target.capIdHash,
      isVaultIdle: r.target.isVaultIdle,
      absoluteCapRaw: r.target.absoluteCapRaw,
      relativeCapWad: r.target.relativeCapWad,
      symbol: r.target.symbol,
      decimals: r.target.decimals,
    },
    assets: r.assets,
    current: r.current,
  }));
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
  /** Market liquidity in USD (Blue market depth). */
  liquidity: number | null;
  /** Market withdrawable liquidity in raw token units. */
  liquidityAssets: string | null;
  tvlUsd: number | null;
  tvlAssets: string | null;
  allocated: number;
  pct: number;
  allocAssets: string | null;
  allocDecimals: number;
  allocSymbol: string | null;
  /** Morpho Blue LLTV (WAD string from GraphQL). Null for idle row. */
  lltv: string | number | null;
  collateralSymbol: string | null;
  loanSymbol: string | null;
  /** For filtering */
  searchHaystack: string;
};

type RowType = TargetRow;

type AllocationSection = 'idle' | 'blue';

const ALLOCATION_SECTIONS: { key: AllocationSection; title: string }[] = [
  { key: 'idle', title: 'Idle' },
  { key: 'blue', title: 'Morpho Blue Market' },
];

function rowSection(_r: TargetRow, t: AllocTarget): AllocationSection {
  if (t.isVaultIdle) return 'idle';
  return 'blue';
}

export function VaultV2Allocations({ vaultAddress, chainId, preloadedData, preloadedRisk }: VaultV2AllocationsProps) {
  const queryClient = useQueryClient();
  const {
    data: fetchedRisk,
    isLoading,
    error,
    refetch: refetchRisk,
  } = useVaultV2Risk(vaultAddress, { initialData: preloadedRisk ?? undefined });
  const {
    data: fetchedGov,
    isLoading: govLoading,
    error: govError,
    refetch: refetchGov,
  } = useVaultV2Governance(vaultAddress);
  const risk = fetchedRisk ?? preloadedRisk;
  const governance = fetchedGov ?? preloadedData;
  const capsUnavailable = !governance && govLoading;

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
      if (marketKey) {
        const byMarket = capByIdHash.get(marketKey.toLowerCase());
        if (byMarket) return byMarket;
      }
      return null;
    },
    [capByIdHash]
  );

  const { rows, totalUsd, targets, planningTotalRaw, chainTotalRaw, vaultDecimals, vaultDisplayDecimals, vaultSymbol } =
    useMemo(() => {
    if (!risk) {
      return {
        rows: [] as RowType[],
        totalUsd: 0,
        targets: [] as AllocTarget[],
        planningTotalRaw: BigInt(0),
        chainTotalRaw: BigInt(0),
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
    const vaultRefUsd = totalUsd;
    let vaultRefRaw = idleRaw;
    const va = risk.vaultAsset;
    const dec = resolveAssetDecimals(va?.symbol, va?.decimals);
    const displayDec = getTokenDisplayDecimals(va?.symbol, dec);
    const sym = va?.symbol ?? '';
    const adapterList = (risk.adapters ?? []).slice().sort((a, b) => (b.allocationUsd ?? 0) - (a.allocationUsd ?? 0));

    const rows: RowType[] = [];
    const targets: AllocTarget[] = [];
    let totalRaw = BigInt(0);

    for (const adapter of adapterList) {
      const marketEntries = collectMorphoBlueMarketEntries(adapter, governance);
      for (const entry of marketEntries) {
        const m = entry.market;
        const col = m.collateralAsset?.symbol;
        const loan = m.loanAsset?.symbol;
        const label = formatMarketPairLabel(col, loan);
        const allocAssets = entry.allocationAssets;
        const allocDec = m.loanAsset?.decimals ?? dec;
        const allocSym = m.loanAsset?.symbol ?? sym;
        const mktPct = totalUsd > 0 ? (entry.allocationUsd / totalUsd) * 100 : 0;

        const marketLiquidity = readMarketLiquidity(
          'state' in m ? m.state : undefined,
          vaultRefUsd,
          vaultRefRaw
        );

        let displayAssets = BigInt(0);
        if (allocAssets) { try { displayAssets = BigInt(allocAssets); } catch { /* */ } }
        let bookedAssets = displayAssets;
        if (entry.bookedAllocationAssets != null) {
          try {
            bookedAssets = BigInt(entry.bookedAllocationAssets);
          } catch {
            /* keep display */
          }
        }
        totalRaw += displayAssets;
        vaultRefRaw += displayAssets;

        const data = encodeMarketParamsData(m);
        const capIdData = encodeMarketCapIdData(adapter.adapterAddress, m);
        const idHash = keccak256(capIdData);
        const marketKey = entry.marketKey;

        const tIdx = targets.length;
        targets.push({
          label,
          adapterAddress: adapter.adapterAddress,
          adapterType: adapter.adapterType,
          data,
          capIdHash: idHash,
          currentAssets: bookedAssets,
          displayAssets,
          currentUsd: entry.allocationUsd,
          decimals: allocDec,
          symbol: allocSym,
          absoluteCapRaw: null,
          relativeCapWad: null,
        });

        rows.push({
          kind: 'target',
          targetIdx: tIdx,
          market: label,
          morphoHref: curatorBlueMarketHref(marketKey, chainId),
          isIdle: false,
          isMorphoBlue: true,
          supplyApy: m.state?.supplyApy ?? null,
          borrowApy: m.state?.borrowApy ?? null,
          utilization: m.state?.utilization ?? null,
          liquidity: marketLiquidity.usd,
          liquidityAssets: marketLiquidity.assets,
          tvlUsd: null,
          tvlAssets: null,
          allocated: entry.allocationUsd,
          pct: mktPct,
          allocAssets,
          allocDecimals: allocDec,
          allocSymbol: allocSym,
          lltv: m.lltv ?? null,
          collateralSymbol: col ?? null,
          loanSymbol: loan ?? null,
          searchHaystack: `${label} ${allocSym ?? ''} ${formatLltvPill(m.lltv ?? null) ?? ''} morpho blue`.toLowerCase(),
        });
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
      displayAssets: idleRaw,
      currentUsd: idleUsd,
      decimals: dec,
      symbol: sym,
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
      searchHaystack: 'idle',
    });

    const planningTotalRaw = totalRaw;
    let chainTotalRaw = planningTotalRaw;
    if (risk.totalAssets) {
      try {
        chainTotalRaw = BigInt(risk.totalAssets);
      } catch {
        /* keep planning total */
      }
    }

    return {
      rows,
      totalUsd,
      targets,
      planningTotalRaw,
      chainTotalRaw,
      vaultDecimals: dec,
      vaultDisplayDecimals: displayDec,
      vaultSymbol: sym,
    };
  }, [risk, governance, chainId]);

  // Attach caps to each target now that `targets` and `capByIdHash` are known.
  const targetsWithCaps: AllocTarget[] = useMemo(() => {
    return targets.map((t) => {
      if (t.isVaultIdle) {
        return { ...t, absoluteCapRaw: null, relativeCapWad: null };
      }
      const marketKey =
        !t.isVaultIdle
          ? (() => {
              const matched = (risk?.adapters ?? [])
                .flatMap((a) => a.markets ?? [])
                .find((m) => {
                  if (!m.market) return false;
                  const data = encodeMarketParamsData(m.market);
                  return data.toLowerCase() === t.data.toLowerCase();
                });
              if (matched?.market) {
                return marketKeyFromGraphQL(matched.market) ?? undefined;
              }
              const capMatch = (governance?.caps ?? []).find(
                (c) =>
                  isMarketCap(c) &&
                  c.adapterAddress?.toLowerCase() === t.adapterAddress.toLowerCase() &&
                  c.marketParams &&
                  encodeMarketParamsData(c.marketParams).toLowerCase() ===
                    t.data.toLowerCase()
              );
              return capMatch?.marketKey ?? undefined;
            })()
          : undefined;
      const cap = capsForTarget(t, marketKey);
      return {
        ...t,
        absoluteCapRaw: cap ? parseBigIntOrNull(cap.absoluteCap) : null,
        relativeCapWad: cap ? parseBigIntOrNull(cap.relativeCap) : null,
      };
    });
  }, [targets, capsForTarget, risk?.adapters, governance?.caps]);

  const targetsWithCapsRef = useRef(targetsWithCaps);
  targetsWithCapsRef.current = targetsWithCaps;

  const [editing, setEditing] = useState(false);
  const [refreshingForEdit, setRefreshingForEdit] = useState(false);
  const [editGeneration, setEditGeneration] = useState(0);
  const [rebalanceRefreshError, setRebalanceRefreshError] = useState<string | null>(null);
  const [inputMode, setInputMode] = useState<InputMode>('tokens');
  const [inputValues, setInputValues] = useState<string[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [filters, setFilters] = usePersistedAllocationFilters(vaultAddress);
  /** Where unallocated remainder goes: 'auto' = implicit Idle, or a target index. */
  const [dustRecipientKey, setDustRecipientKey] = useState<DustRecipientChoice>('auto');
  const [rebalancePreviewOpen, setRebalancePreviewOpen] = useState(false);
  const [preparingPreview, setPreparingPreview] = useState(false);
  const [queueingSafe, setQueueingSafe] = useState(false);
  const [queueSafeError, setQueueSafeError] = useState<string | null>(null);
  const [preparedSubmit, setPreparedSubmit] = useState<{
    rows: RebalancePlanRow[];
    preview: TxPreview;
    clampWarning: string | null;
  } | null>(null);
  const multicallWrite = useVaultWrite({ chainId: chainId ?? BASE_CHAIN_ID });
  const resetMulticallWrite = multicallWrite.reset;
  const publicClient = usePublicClient({ chainId: chainId ?? BASE_CHAIN_ID });
  const { address: walletAddress } = useAccount();
  const router = useRouter();
  const { connected: safeAppConnected, sdk: safeAppSdk, safeRole: safeAppRole } =
    useCuratorSafeApps();
  const allocatorSafeAppSdk = useMemo(
    () =>
      safeAppConnected && safeAppSdk && safeAppRole === 'allocator' ? safeAppSdk : null,
    [safeAppConnected, safeAppSdk, safeAppRole]
  );

  const allocationWriteMode = useMemo(
    () => resolveAllocationWriteMode(governance?.allocators, walletAddress),
    [governance?.allocators, walletAddress]
  );

  useEffect(() => {
    if (!multicallWrite.isSuccess) return;
    void (async () => {
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ['vault-v2-risk', vaultAddress] }),
        queryClient.refetchQueries({ queryKey: vaultV2GovernanceQueryKey(vaultAddress) }),
        queryClient.refetchQueries({ queryKey: ['vault-reallocations', vaultAddress] }),
        queryClient.refetchQueries({ queryKey: ['vault', vaultAddress] }),
      ]);
      setEditing(false);
      setInputValues([]);
      setSubmitError(null);
      setRebalancePreviewOpen(false);
      setPreparedSubmit(null);
      resetMulticallWrite();
    })();
  }, [multicallWrite.isSuccess, queryClient, vaultAddress, resetMulticallWrite]);

  const beginRebalance = useCallback(async () => {
    setRefreshingForEdit(true);
    setSubmitError(null);
    setRebalanceRefreshError(null);
    try {
      const [riskResult, govResult] = await Promise.all([refetchRisk(), refetchGov()]);
      const formatErr = (error: unknown) =>
        error instanceof Error ? error.message : 'Unknown error';

      if (riskResult.isError && !fetchedRisk && !preloadedRisk) {
        setRebalanceRefreshError(`Could not load allocations: ${formatErr(riskResult.error)}`);
        return;
      }

      const warnings: string[] = [];
      if (riskResult.isError) {
        warnings.push(`allocations (${formatErr(riskResult.error)})`);
      }
      if (govResult.isError) {
        warnings.push(`governance caps (${formatErr(govResult.error)})`);
      }
      if (warnings.length > 0) {
        setSubmitError(`Could not refresh ${warnings.join(' and ')}. Edit mode uses last loaded data.`);
      }

      setEditGeneration((g) => g + 1);
    } finally {
      setRefreshingForEdit(false);
    }
  }, [refetchRisk, refetchGov, fetchedRisk, preloadedRisk]);

  useEffect(() => {
    if (editGeneration === 0) return;

    const caps = targetsWithCapsRef.current;
    setInputMode('tokens');
    setInputValues(caps.map(() => ''));
    setDustRecipientKey('auto');
    setPreparedSubmit(null);
    setEditing(true);
  }, [editGeneration]);

  const cancelEditing = useCallback(() => {
    setEditing(false);
    setSubmitError(null);
    setRebalanceRefreshError(null);
    multicallWrite.reset();
  }, [multicallWrite]);

  const updateInput = useCallback((idx: number, val: string) => {
    setSubmitError(null);
    setInputValues((prev) => prev.map((v, i) => (i === idx ? val : v)));
  }, []);

  const parseInputToRaw = useCallback(
    (idx: number, val: string): bigint => {
      return resolveTargetAssetsFromInput(
        idx,
        val,
        inputMode,
        targetsWithCaps,
        planningTotalRaw
      ).assets;
    },
    [inputMode, targetsWithCaps, planningTotalRaw]
  );

  const formatRawAsInput = useCallback(
    (raw: bigint, t: AllocTarget): string => {
      if (inputMode === 'percentage') {
        return rawToPercentInput(raw, planningTotalRaw);
      }
      return formatAllocationEditInput(raw, t.symbol, t.decimals);
    },
    [inputMode, planningTotalRaw]
  );

  const switchInputMode = useCallback(
    (mode: InputMode) => {
      setInputValues((prev) => {
        const values =
          prev.length === targetsWithCaps.length ? prev : targetsWithCaps.map(() => '');
        const resolvedAssets = targetsWithCaps.map((t, i) =>
          resolveTargetAssetsFromInput(
            i,
            values[i] ?? '',
            inputMode,
            targetsWithCaps,
            planningTotalRaw
          ).assets
        );
        if (mode === 'percentage') {
          return resolvedAssets.map((raw) => rawToPercentInput(raw, planningTotalRaw));
        }
        return resolvedAssets.map((raw, i) => {
          const t = targetsWithCaps[i]!;
          if (raw === t.displayAssets) return '';
          return formatAllocationEditInputExact(raw, t.symbol, t.decimals, false);
        });
      });
      setInputMode(mode);
      setSubmitError(null);
    },
    [inputMode, targetsWithCaps, planningTotalRaw]
  );

  const setRowZero = useCallback(
    (targetIdx: number) => {
      setSubmitError(null);
      setInputValues((prev) => {
        const values = prev.length === targetsWithCaps.length ? [...prev] : targetsWithCaps.map(() => '');

        const resolveRowAssets = (idx: number, vals: string[]): bigint =>
          resolveTargetAssetsFromInput(
            idx,
            vals[idx] ?? '',
            inputMode,
            targetsWithCaps,
            planningTotalRaw
          ).assets;

        if (inputMode === 'percentage') {
          values[targetIdx] = '0.00';
        } else {
          values[targetIdx] = '0';
        }

        const idleIdx = targetsWithCaps.findIndex((row) => row.isVaultIdle);
        if (idleIdx >= 0 && targetIdx !== idleIdx) {
          const idleTarget = computeIdleTargetFromStrategyPlan(
            planningTotalRaw,
            targetsWithCaps.map((row) => ({ isVaultIdle: row.isVaultIdle })),
            (idx) => resolveRowAssets(idx, values)
          );
          if (inputMode === 'percentage') {
            values[idleIdx] = rawToPercentInput(idleTarget, planningTotalRaw);
          } else {
            const idleRow = targetsWithCaps[idleIdx]!;
            values[idleIdx] = formatAllocationEditInputExact(
              idleTarget,
              idleRow.symbol,
              idleRow.decimals,
              false
            );
          }
        }

        return values;
      });
    },
    [inputMode, targetsWithCaps, planningTotalRaw]
  );

  const setRowMax = useCallback(
    (targetIdx: number) => {
      const t = targetsWithCaps[targetIdx];
      if (!t) return;

      const resolveRowAssets = (idx: number, values: string[]): bigint =>
        resolveTargetAssetsFromInput(
          idx,
          values[idx] ?? '',
          inputMode,
          targetsWithCaps,
          planningTotalRaw
        ).assets;

      const idleIdx = targetsWithCaps.findIndex((row) => row.isVaultIdle);

      setInputValues((prev) => {
        const values = prev.length === targetsWithCaps.length ? [...prev] : targetsWithCaps.map(() => '');

        const deployableIdle = computeDeployableIdle(
          targetsWithCaps.map((row) => ({
            isVaultIdle: row.isVaultIdle,
            currentAssets: row.currentAssets,
          })),
          (idx) => resolveRowAssets(idx, values),
          targetIdx
        );

        if (t.isVaultIdle) {
          const idleTarget = computeIdleTargetFromStrategyPlan(
            planningTotalRaw,
            targetsWithCaps.map((row) => ({ isVaultIdle: row.isVaultIdle })),
            (idx) => resolveRowAssets(idx, values)
          );
          if (inputMode === 'percentage') {
            values[targetIdx] = rawToPercentInput(idleTarget, planningTotalRaw);
          } else {
            values[targetIdx] = formatAllocationEditInputExact(
              idleTarget,
              t.symbol,
              t.decimals,
              false
            );
          }
          return values;
        }

        const maxTarget = maxTargetFromIdleDeploy(
          t.currentAssets,
          t,
          planningTotalRaw,
          deployableIdle
        );

        if (inputMode === 'percentage') {
          values[targetIdx] = rawToPercentInput(maxTarget, planningTotalRaw);
        } else {
          values[targetIdx] = formatAllocationEditInputExact(
            maxTarget,
            t.symbol,
            t.decimals,
            false
          );
        }

        if (idleIdx >= 0) {
          const nextValues = [...values];
          const idleTarget = computeIdleTargetFromStrategyPlan(
            planningTotalRaw,
            targetsWithCaps.map((row) => ({ isVaultIdle: row.isVaultIdle })),
            (idx) =>
              idx === targetIdx
                ? maxTarget
                : resolveRowAssets(idx, nextValues)
          );
          if (inputMode === 'percentage') {
            nextValues[idleIdx] = rawToPercentInput(idleTarget, planningTotalRaw);
          } else {
            const idleRow = targetsWithCaps[idleIdx]!;
            nextValues[idleIdx] = formatAllocationEditInputExact(
              idleTarget,
              idleRow.symbol,
              idleRow.decimals,
              false
            );
          }
          return nextValues;
        }

        return values;
      });
    },
    [inputMode, targetsWithCaps, planningTotalRaw]
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
        planningTotalRaw
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
    const diff = planningTotalRaw - inputSum;
    const overshoot = diff < BigInt(0);
    const idleIdx = results.findIndex((r) => r.target.isVaultIdle);

    let adjustedResults = results;
    let dustDiff = BigInt(0);
    let dustRecipientIdx: number | null = null;
    let clampWarning: string | null = null;

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
        planningTotalRaw,
        explicitRecipientIdx,
        (r) => r.assets,
        (r, assets) => ({ ...r, assets })
      );
      if (!dustResult.error) {
        adjustedResults = dustResult.items;
        dustDiff = dustResult.diff;
        dustRecipientIdx = explicitRecipientIdx;
      } else {
        return {
          valid: false as const,
          error: dustResult.error,
          results: adjustedResults,
          inputSum,
          sumAssets: inputSum,
          dustDiff: BigInt(0),
          dustRecipientIdx: null as number | null,
        };
      }
    } else if (
      // Auto (Idle): absorb under-allocation remainder into idle planning row.
      !overshoot &&
      diff !== BigInt(0) &&
      dustRecipientKey === 'auto' &&
      idleIdx >= 0
    ) {
      const dustResult = applyPlanningDust(
        results,
        planningTotalRaw,
        idleIdx,
        (r) => r.assets,
        (r, assets) => ({ ...r, assets })
      );
      if (!dustResult.error) {
        adjustedResults = dustResult.items;
        dustDiff = dustResult.diff;
        dustRecipientIdx = idleIdx;
      } else {
        return {
          valid: false as const,
          error: dustResult.error,
          results: adjustedResults,
          inputSum,
          sumAssets: inputSum,
          dustDiff: BigInt(0),
          dustRecipientIdx: null as number | null,
        };
      }
    }

    let sumAssets = adjustedResults.reduce((s, r) => s + r.assets, BigInt(0));

    if (sumAssets > planningTotalRaw) {
      const trimmed = trimPlanToVaultTotal(
        adjustedResults.map((r) => ({
          target: {
            label: r.target.label,
            adapterAddress: r.target.adapterAddress,
            data: r.target.data,
            capIdHash: r.target.capIdHash,
            isVaultIdle: r.target.isVaultIdle,
            absoluteCapRaw: r.target.absoluteCapRaw,
            relativeCapWad: r.target.relativeCapWad,
          },
          assets: r.assets,
          current: r.current,
        })),
        planningTotalRaw
      );
      adjustedResults = trimmed.map((row, i) => ({
        target: adjustedResults[i]!.target,
        assets: row.assets,
        current: row.current,
      }));
    }

    const fundingResult = clampPlanToFundableIdle(
      adjustedResults.map((r) => ({
        target: {
          label: r.target.label,
          adapterAddress: r.target.adapterAddress,
          data: r.target.data,
          capIdHash: r.target.capIdHash,
          isVaultIdle: r.target.isVaultIdle,
          absoluteCapRaw: r.target.absoluteCapRaw,
          relativeCapWad: r.target.relativeCapWad,
          symbol: r.target.symbol,
          decimals: r.target.decimals,
        },
        assets: r.assets,
        current: r.current,
      }))
    );
    if (fundingResult.reduced) {
      clampWarning = CLAMP_TO_FUNDABLE_WARNING;
    }
    adjustedResults = fundingResult.rows.map((row, i) => ({
      target: adjustedResults[i]!.target,
      assets: row.assets,
      current: row.current,
    }));
    sumAssets = adjustedResults.reduce((s, r) => s + r.assets, BigInt(0));

    if (adjustedResults.some((r) => r.assets < BigInt(0))) {
      return {
        valid: false as const,
        error: 'Allocation would go negative',
        results: [] as Result[],
        inputSum,
        sumAssets,
        dustDiff: BigInt(0),
        dustRecipientIdx: null as number | null,
      };
    }

    if (!governance?.caps?.length && govError) {
      return {
        valid: false as const,
        error: 'Governance data failed to load — cap validation unavailable.',
        results: adjustedResults,
        inputSum,
        sumAssets,
        dustDiff,
        dustRecipientIdx,
      };
    }

    // Cap validation (strategy adapters only — idle has no on-chain cap)
    for (const r of adjustedResults) {
      if (r.target.isVaultIdle) continue;
      if (r.assets <= r.current) continue;
      const t = r.target;
      if (t.absoluteCapRaw == null) {
        return {
          valid: false as const,
          error: `${t.label}: absolute cap unknown — cannot verify allocate (would revert on-chain).`,
          results: [] as Result[],
          inputSum,
          sumAssets,
          dustDiff,
          dustRecipientIdx,
        };
      }
      if (t.absoluteCapRaw === BigInt(0)) {
        return {
          valid: false as const,
          error: `${t.label}: zero absolute cap — allocation disabled on-chain.`,
          results: [] as Result[],
          inputSum,
          sumAssets,
          dustDiff,
          dustRecipientIdx,
        };
      }
      if (r.assets > t.absoluteCapRaw) {
        return {
          valid: false as const,
          error: `${t.label}: allocation exceeds absolute cap (${formatRawTokenAmount(t.absoluteCapRaw, resolveAssetDecimals(t.symbol, t.decimals), getTokenDisplayDecimals(t.symbol, t.decimals))} ${t.symbol}).`,
          results: [] as Result[],
          inputSum,
          sumAssets,
          dustDiff,
          dustRecipientIdx,
        };
      }
      if (t.relativeCapWad != null && chainTotalRaw > BigInt(0)) {
        // allocation <= firstTotalAssets * relativeCap / 1e18 — chain total at tx start.
        const wad = BigInt('1000000000000000000');
        const maxAllowed = (chainTotalRaw * t.relativeCapWad) / wad;
        if (t.relativeCapWad < wad && r.assets > maxAllowed) {
          return {
            valid: false as const,
            error: `${t.label}: allocation exceeds relative cap (${(Number(t.relativeCapWad) / 1e16).toFixed(2)}% of vault).`,
            results: [] as Result[],
            inputSum,
            sumAssets,
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
        error:
          'No adapter allocation changes — adjust strategy targets (Zero / Max) or deploy idle via Max on a capped row.',
        results: adjustedResults,
        inputSum,
        sumAssets,
        dustDiff,
        dustRecipientIdx,
      };
    }

    const fundingError = validateIdleFunding(
      adjustedResults.map((r) => ({
        target: {
          label: r.target.label,
          adapterAddress: r.target.adapterAddress,
          data: r.target.data,
          capIdHash: r.target.capIdHash,
          isVaultIdle: r.target.isVaultIdle,
          absoluteCapRaw: r.target.absoluteCapRaw,
          relativeCapWad: r.target.relativeCapWad,
        },
        assets: r.assets,
        current: r.current,
      }))
    );
    if (fundingError) {
      return {
        valid: false as const,
        error: fundingError,
        results: adjustedResults,
        inputSum,
        sumAssets,
        dustDiff,
        dustRecipientIdx,
      };
    }

    return {
      valid: true as const,
      error: null,
      results: adjustedResults,
      inputSum,
      sumAssets,
      dustDiff,
      dustRecipientIdx,
      clampWarning,
    };
  }, [editing, inputValues, targetsWithCaps, inputMode, planningTotalRaw, chainTotalRaw, dustRecipientKey, governance, govError]);

  useEffect(() => {
    setPreparedSubmit(null);
  }, [resolvedAllocations]);

  const openRebalancePreview = useCallback(async () => {
    if (!resolvedAllocations?.valid || !publicClient) return;

    setPreparingPreview(true);
    setSubmitError(null);

    try {
      const vault = getAddress(vaultAddress);
      const chainTotal = (await publicClient.readContract({
        address: vault,
        abi: vaultV2Abi,
        functionName: 'totalAssets',
      })) as bigint;

      const planRows = mapResultsToPlanRows(resolvedAllocations.results);
      const finalized = await finalizeRebalancePlan(
        publicClient,
        vaultAddress,
        planRows,
        chainTotal
      );

      if (finalized.error) {
        setSubmitError(finalized.error);
        return;
      }

      const basePreview = buildAllocationRebalancePreview(
        finalized.rows.map((r) => ({
          label: r.target.label,
          symbol: r.target.symbol ?? vaultSymbol,
          decimals: r.target.decimals ?? vaultDecimals,
          isVaultIdle: r.target.isVaultIdle,
          currentAssets: r.current,
          assets: r.assets,
        })),
        vaultSymbol
      );

      if (!basePreview) {
        setSubmitError('No on-chain allocation changes to submit.');
        return;
      }

      const preview =
        finalized.clampWarning != null
          ? {
              ...basePreview,
              footnote: [basePreview.footnote, finalized.clampWarning]
                .filter(Boolean)
                .join(' '),
            }
          : basePreview;

      setPreparedSubmit({
        rows: finalized.rows,
        preview,
        clampWarning: finalized.clampWarning,
      });
      setRebalancePreviewOpen(true);
    } catch {
      setSubmitError('Could not prepare rebalance preview — try again.');
    } finally {
      setPreparingPreview(false);
    }
  }, [
    resolvedAllocations,
    publicClient,
    vaultAddress,
    vaultSymbol,
    vaultDecimals,
  ]);

  const handleRebalance = useCallback(async () => {
    if (!preparedSubmit || !publicClient) return;

    multicallWrite.reset();
    setSubmitError(null);

    const vault = getAddress(vaultAddress);
    const submitRows = preparedSubmit.rows;

    const { deallocCalls, allocCalls } = buildRebalanceMulticallData(submitRows);
    const allCalls = [...deallocCalls, ...allocCalls];
    if (allCalls.length === 0) {
      setSubmitError('No on-chain allocation changes to submit.');
      return;
    }

    if (!walletAddress) {
      setSubmitError('Connect your wallet using the button in the top bar.');
      return;
    }

    try {
      if (allCalls.length === 1) {
        const changed = submitRows.find(
          (r) => !r.target.isVaultIdle && r.assets !== r.current
        );
        if (!changed) return;

        if (changed.assets > changed.current) {
          const delta = changed.assets - changed.current;
          const adapter = changed.target.adapterAddress as Address;
          const data = changed.target.data;
          await publicClient.simulateContract({
            account: walletAddress,
            address: vault,
            abi: vaultV2Abi,
            functionName: 'allocate',
            args: [adapter, data, delta],
          });
          await multicallWrite.write(
            v2WriteConfigs.allocate(vault, adapter, data, delta)
          );
        } else {
          const delta = changed.current - changed.assets;
          const safeDelta =
            changed.assets === 0n
              ? changed.current
              : clampDeallocateAmount(delta, changed.current);
          if (safeDelta <= 0n) return;
          const adapter = changed.target.adapterAddress as Address;
          const data = changed.target.data;
          await publicClient.simulateContract({
            account: walletAddress,
            address: vault,
            abi: vaultV2Abi,
            functionName: 'deallocate',
            args: [adapter, data, safeDelta],
          });
          await multicallWrite.write(
            v2WriteConfigs.deallocate(vault, adapter, data, safeDelta)
          );
        }
      } else {
        await publicClient.simulateContract({
          account: walletAddress,
          address: vault,
          abi: vaultV2Abi,
          functionName: 'multicall',
          args: [allCalls],
        });
        await multicallWrite.write(v2WriteConfigs.multicall(vault, allCalls));
      }
    } catch (error) {
      setSubmitError(formatWriteError(error));
    }
  }, [
    preparedSubmit,
    vaultAddress,
    multicallWrite,
    publicClient,
    walletAddress,
  ]);

  const handleQueueInAllocatorSafe = useCallback(async () => {
    if (!preparedSubmit) return;

    setQueueingSafe(true);
    setQueueSafeError(null);

    try {
      await queueVaultRebalanceInSafe({
        vaultAddress: getAddress(vaultAddress),
        submitRows: preparedSubmit.rows,
        preview: preparedSubmit.preview,
        vaultSymbol,
        proposer: walletAddress ? getAddress(walletAddress) : undefined,
        safeAppSdk: allocatorSafeAppSdk,
      });
      setRebalancePreviewOpen(false);
      setPreparedSubmit(null);
      setEditing(false);
      router.push('/safe/allocator');
    } catch (error) {
      setQueueSafeError(error instanceof Error ? error.message : 'Failed to queue Safe transaction.');
    } finally {
      setQueueingSafe(false);
    }
  }, [allocatorSafeAppSdk, preparedSubmit, vaultAddress, vaultSymbol, walletAddress, router]);

  const getEditedAllocationDisplay = useCallback(
    (targetIdx: number): { raw: bigint; pct: number; usd: number } => {
      const t = targetsWithCaps[targetIdx];
      if (!t) return { raw: BigInt(0), pct: 0, usd: 0 };
      const raw = parseInputToRaw(targetIdx, inputValues[targetIdx] ?? '');
      const pct =
        planningTotalRaw > BigInt(0)
          ? Number((raw * BigInt(10000)) / planningTotalRaw) / 100
          : 0;
      const usd =
        t.displayAssets > BigInt(0)
          ? (t.currentUsd * Number(raw)) / Number(t.displayAssets)
          : 0;
      return { raw, pct, usd };
    },
    [inputValues, parseInputToRaw, targetsWithCaps, planningTotalRaw]
  );

  const getRowPercent = useCallback(
    (targetIdx: number): number => {
      const t = targetsWithCaps[targetIdx];
      if (!t) return 0;
      if (!editing) {
        return planningTotalRaw > BigInt(0)
          ? Number((t.displayAssets * BigInt(10000)) / planningTotalRaw) / 100
          : 0;
      }
      const v = inputValues[targetIdx]?.trim() ?? '';
      if (!v) {
        return planningTotalRaw > BigInt(0)
          ? Number((t.displayAssets * BigInt(10000)) / planningTotalRaw) / 100
          : 0;
      }
      if (inputMode === 'percentage') {
        const pct = parseFloat(v);
        return Number.isFinite(pct) ? pct : 0;
      }
      const raw = parseInputToRaw(targetIdx, v);
      return planningTotalRaw > BigInt(0)
        ? Number((raw * BigInt(10000)) / planningTotalRaw) / 100
        : 0;
    },
    [editing, inputMode, inputValues, parseInputToRaw, targetsWithCaps, planningTotalRaw]
  );

  if (!risk && isLoading) {
    return (
      <div className="space-y-4">
        <Card>
          <CardHeader><CardTitle>Liquidity Adapter</CardTitle></CardHeader>
          <CardContent><Skeleton className="h-20 w-full" /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Allocation</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </CardContent>
        </Card>
      </div>
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
    t.displayAssets === BigInt(0) &&
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

    let show = true;
    if (filters.onlyIdle && !isIdleRow) show = false;
    if (search && !r.searchHaystack.includes(search)) show = false;
    if (filters.hideZero && t.displayAssets === BigInt(0)) show = false;
    if (filters.hideIdle && isIdleRow) show = false;
    if (filters.onlyWithCapacity) {
      if (t.isVaultIdle || !hasRemainingCapacity(t, chainTotalRaw)) show = false;
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
        return compareBigIntAsc(ta.displayAssets, tb.displayAssets);
      case 'supplyApy-desc':
        return (rb.supplyApy ?? -Infinity) - (ra.supplyApy ?? -Infinity);
      case 'utilization-desc':
        return (rb.utilization ?? -Infinity) - (ra.utilization ?? -Infinity);
      case 'borrowApy-desc':
        return (rb.borrowApy ?? -Infinity) - (ra.borrowApy ?? -Infinity);
      case 'liquidity-desc':
        return (rb.liquidity ?? -Infinity) - (ra.liquidity ?? -Infinity);
      case 'liquidity-asc':
        return (ra.liquidity ?? Infinity) - (rb.liquidity ?? Infinity);
      case 'capacity-desc': {
        const headroom = (t: AllocTarget): bigint => {
          if (t.absoluteCapRaw == null) return BigInt(0);
          const h = t.absoluteCapRaw - t.displayAssets;
          return h > 0n ? h : 0n;
        };
        return compareBigIntDesc(headroom(tb), headroom(ta));
      }
      case 'name-asc':
        return ra.market.localeCompare(rb.market);
      case 'name-desc':
        return rb.market.localeCompare(ra.market);
      case 'allocated-desc':
      default:
        return compareBigIntDesc(ta.displayAssets, tb.displayAssets);
    }
  });

  const rowsToRender: RowType[] = [];
  for (const idx of sortedTargetIndices) {
    const tr = rows.find((r) => r.targetIdx === idx);
    if (tr) rowsToRender.push(tr);
  }

  const plannedSum = resolvedAllocations?.inputSum ?? BigInt(0);
  const remainingRaw = editing ? planningTotalRaw - plannedSum : BigInt(0);
  const hasEditingInputs = editing && inputValues.some((v) => v.trim() !== '');

  // Strategy targets the curator can route unallocated remainder to ('auto' = Idle).
  const dustOptions = targetsWithCaps
    .map((t, idx) => ({ id: String(idx), label: t.label, isVaultIdle: t.isVaultIdle }))
    .filter((o) => !o.isVaultIdle && !isDelistedTarget(targetsWithCaps[Number(o.id)]))
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

  const buildOptionalCells = (r: TargetRow, t: AllocTarget, isIdle: boolean): ReactNode[] => {
    const visible = getCuratorVisibleColumns(filters.columns);
    return visible.map((col) => {
      switch (col.filterKey) {
        case 'effectiveCap':
          return formatRowCapCell(t, isIdle, filters);
        case 'supplyApy': {
          if (isIdle) return '—';
          const label = formatOrDash(scalePercent(r.supplyApy));
          if (!r.isMorphoBlue && label !== '—') {
            return <span title="Underlying vault net APY">{label}</span>;
          }
          return label;
        }
        case 'borrowApy':
          return isIdle ? '—' : formatOrDash(scalePercent(r.borrowApy));
        case 'liquidity':
          return isIdle
            ? '—'
            : formatLiquidityCell(
                r,
                r.allocSymbol ?? t.symbol,
                r.allocDecimals ?? t.decimals,
                totalUsd,
                planningTotalRaw,
                filters.liquidityUnit
              );
        case 'utilization':
          return isIdle ? '—' : formatOrDash(scalePercent(r.utilization));
        case 'allocated':
          return isIdle ? '—' : formatFullUSD(r.allocated, 2);
        case 'percentCap':
          return formatEffRelCap(t, isIdle);
        default:
          return '—';
      }
    });
  };

  const renderAllocationRow = (r: TargetRow) => {
    const t = targetsWithCaps[r.targetIdx];
    const lltvPill = formatLltvPill(r.lltv);
    const isIdle = Boolean(t.isVaultIdle);

    const editedDisplay = editing ? getEditedAllocationDisplay(r.targetIdx) : null;
    const allocationAmount =
      editedDisplay != null
        ? filters.displayMode === 'percent'
          ? `${editedDisplay.pct.toFixed(2)}%`
          : formatAllocationAmount(
              filters.amountUnit,
              editedDisplay.usd,
              editedDisplay.raw,
              r.allocSymbol ?? t.symbol,
              r.allocDecimals ?? t.decimals
            )
        : formatRowAllocationCell(r, t, filters);

    const inputWidthCh = allocationInputWidthCh(t.symbol, t.decimals);

    const percentAllocated = (
      <AllocationPctIndicator pct={getRowPercent(r.targetIdx)} />
    );

    const tags = lltvPill ? <AllocationPill>{lltvPill}</AllocationPill> : null;

    return (
      <CuratorAllocationListRow
        key={`target-${r.targetIdx}`}
        editing={editing}
        columns={filters.columns}
        className={isIdle ? 'bg-muted/30' : undefined}
        name={
          isIdle ? (
            r.market
          ) : (
            <MorphoAllocationLink href={r.morphoHref}>{r.market}</MorphoAllocationLink>
          )
        }
        tags={lltvPill ? tags : undefined}
        allocationAmount={allocationAmount}
        optionalCells={buildOptionalCells(r, t, isIdle)}
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
                title={
                  isIdle
                    ? 'Set idle to vault remainder after other row targets'
                    : 'Add idle + tokens freed by other rows set to 0 (caps apply)'
                }
              >
                Max
              </Button>
              <Input
                type="text"
                inputMode="decimal"
                placeholder={formatRawAsInput(t.displayAssets, t)}
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
    <div className="space-y-4">
      <VaultV2LiquidityAdapter
        vaultAddress={vaultAddress}
        governance={governance}
        risk={risk}
      />
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div>
            <CardTitle>Allocation</CardTitle>
            <CardDescription>
              Total:{' '}
              {filters.amountUnit === 'usd'
                ? formatFullUSD(totalUsd, 2)
                : `${formatRawTokenAmount(planningTotalRaw, vaultDecimals, vaultDisplayDecimals)} ${vaultSymbol}`}
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <AllocationFilters
              value={filters}
              onChange={setFilters}
              onReset={() => clearAllocationFilters(vaultAddress)}
              editing={editing}
            />
            {!editing ? (
              <Button
                variant="outline"
                size="sm"
                onClick={beginRebalance}
                disabled={refreshingForEdit}
                className="flex items-center gap-1.5"
              >
                {refreshingForEdit ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Pencil className="h-3.5 w-3.5" />
                )}
                {refreshingForEdit ? 'Refreshing…' : 'Rebalance'}
              </Button>
            ) : (
              <div className="flex items-center gap-2">
                <div className="flex gap-0.5 rounded-md border p-0.5">
                  <button
                    onClick={() => switchInputMode('percentage')}
                    className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${inputMode === 'percentage' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                  >%</button>
                  <button
                    onClick={() => switchInputMode('tokens')}
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
        {govError && !governance?.caps?.length && (
          <div className="mb-3 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <p className="text-xs text-amber-800 dark:text-amber-200">
              Governance data failed to load: {govError instanceof Error ? govError.message : 'Unknown error'}.
              Caps and some markets may be missing — rebalancing is disabled until this resolves.
            </p>
          </div>
        )}
        {govError && (governance?.caps?.length ?? 0) > 0 && (
          <div className="mb-3 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <p className="text-xs text-amber-800 dark:text-amber-200">
              Live governance refresh failed — showing cached caps. Rebalance still uses on-chain overlay when the risk/governance APIs succeed.
            </p>
          </div>
        )}
        {capsUnavailable && !govError && (
          <div className="mb-3 text-xs text-muted-foreground">Loading governance caps…</div>
        )}
        {rebalanceRefreshError && !editing && (
          <div className="mb-3 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950/30">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
            <p className="text-xs text-red-700 dark:text-red-300">{rebalanceRefreshError}</p>
          </div>
        )}
        {editing && hasEditingInputs && (
          <div className="mb-3 space-y-2">
            <RemainingBanner
              totalRaw={planningTotalRaw}
              plannedRaw={plannedSum}
              remainingRaw={remainingRaw}
              decimals={vaultDecimals}
              symbol={vaultSymbol}
              dustDiff={resolvedAllocations?.dustDiff ?? BigInt(0)}
              implicitIdle
              dustRecipientLabel={dustRecipientLabel}
              parseError={resolvedAllocations?.error ?? null}
            />
            {resolvedAllocations?.clampWarning && (
              <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <p className="text-xs text-amber-800 dark:text-amber-200">
                  {resolvedAllocations.clampWarning} Confirm preview before signing.
                </p>
              </div>
            )}
            <DustRecipientSelect
              value={dustRecipientKey}
              onChange={setDustRecipientKey}
              options={dustOptions}
              autoLabel="Idle (default)"
            />
          </div>
        )}

        <AllocationListShell>
          <CuratorAllocationListHeader editing={editing} columns={filters.columns} />
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

            {resolvedAllocations?.valid && remainingRaw === BigInt(0) && (
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
                  Transaction confirmed! Allocations will refresh shortly.
                </p>
              </div>
            )}

            {submitError && (
              <div className="flex items-start gap-2 rounded-md bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 p-3">
                <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-red-700 dark:text-red-300">{submitError}</p>
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
              label={
                preparingPreview
                  ? 'Preparing…'
                  : multicallWrite.isLoading
                    ? 'Confirming...'
                    : 'Rebalance'
              }
              onClick={() => void openRebalancePreview()}
              disabled={!resolvedAllocations?.valid || preparingPreview}
              isLoading={multicallWrite.isLoading || preparingPreview}
              isSuccess={multicallWrite.isSuccess}
              error={multicallWrite.error}
              txHash={multicallWrite.txHash}
            />

            <TxPreviewDialog
              open={rebalancePreviewOpen}
              preview={preparedSubmit?.preview ?? null}
              onOpenChange={(open) => {
                setRebalancePreviewOpen(open);
                if (!open) {
                  setPreparedSubmit(null);
                  setQueueSafeError(null);
                }
              }}
              writeMode={allocationWriteMode}
              onConfirm={
                allocationWriteMode === 'safe'
                  ? () => void handleQueueInAllocatorSafe()
                  : handleRebalance
              }
              isLoading={
                allocationWriteMode === 'safe' ? queueingSafe : multicallWrite.isLoading
              }
              error={
                allocationWriteMode === 'safe'
                  ? queueSafeError
                    ? new Error(queueSafeError)
                    : null
                  : submitError
                    ? new Error(submitError)
                    : multicallWrite.error
              }
              confirmLabel={
                allocationWriteMode === 'safe'
                  ? 'Queue in Allocator Safe'
                  : 'Confirm rebalance'
              }
              secondaryLabel={
                allocationWriteMode === 'both' ? 'Queue in Allocator Safe' : undefined
              }
              onSecondary={
                allocationWriteMode === 'both'
                  ? () => void handleQueueInAllocatorSafe()
                  : undefined
              }
              secondaryLoading={queueingSafe}
              secondaryError={queueSafeError ? new Error(queueSafeError) : null}
            />

            {multicallWrite.txHash && (
              <p className="text-xs text-muted-foreground break-all">Tx: {multicallWrite.txHash}</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
    </div>
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
