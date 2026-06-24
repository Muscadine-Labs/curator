'use client';

import { useMemo, useState, useCallback, useEffect, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertTriangle, CheckCircle2, Pencil } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useVaultV2Risk } from '@/lib/hooks/useVaultV2Risk';
import { useVaultV2Governance } from '@/lib/hooks/useVaultV2Governance';
import { useVaultWrite } from '@/lib/hooks/useVaultWrite';
import { TransactionButton } from '@/components/TransactionButton';
import { TxPreviewDialog } from '@/components/morpho/TxPreviewDialog';
import { buildAllocationRebalancePreview } from '@/lib/morpho/tx-preview';
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
import type { V2VaultRiskResponse } from '@/app/api/vaults/v2/[id]/risk/route';
import type { VaultV2GovernanceResponse, CapInfo } from '@/app/api/vaults/v2/[id]/governance/route';
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
import { DustRecipientSelect } from '@/components/morpho/DustRecipientSelect';
import {
  marketKeyFromGraphQL,
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

function compareBigIntDesc(a: bigint, b: bigint): number {
  if (a === b) return 0;
  return a > b ? -1 : 1;
}

function compareBigIntAsc(a: bigint, b: bigint): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Unallocated vault cash (Idle row). */
function vaultIdleRaw(targets: ReadonlyArray<AllocTarget>): bigint {
  return targets.find((t) => t.isVaultIdle)?.currentAssets ?? BigInt(0);
}

/** Cap-limited idle amount deployable onto a strategy row. */
function idleDeployAmount(
  t: AllocTarget,
  totalRaw: bigint,
  idleRaw: bigint
): bigint {
  if (t.isVaultIdle) return idleRaw;

  let deploy = idleRaw;
  if (t.absoluteCapRaw != null) {
    const headroom = t.absoluteCapRaw - t.currentAssets;
    if (headroom <= 0n) return 0n;
    if (deploy > headroom) deploy = headroom;
  }
  if (t.relativeCapWad != null && totalRaw > BigInt(0)) {
    const wad = BigInt('1000000000000000000');
    const maxRel = (totalRaw * t.relativeCapWad) / wad;
    const headroom = maxRel - t.currentAssets;
    if (headroom <= 0n) return 0n;
    if (deploy > headroom) deploy = headroom;
  }
  return deploy > 0n ? deploy : 0n;
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
  const raw = r.allocAssets != null ? BigInt(r.allocAssets) : t.currentAssets;
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
  totalRaw: bigint,
  options?: { parseAsIdleDeploy?: boolean }
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
    const portion = (totalRaw * BigInt(Math.round(pct * 1e10))) / BigInt(1e12);
    const assets =
      options?.parseAsIdleDeploy && !t.isVaultIdle
        ? t.currentAssets + portion
        : portion;
    return { assets, error: null };
  }
  try {
    const parsed = parseHumanTokenInput(v, t.symbol, t.decimals);
    if (parsed < 0n) {
      return { assets: t.currentAssets, error: `Negative amount for ${t.label}` };
    }
    const assets =
      options?.parseAsIdleDeploy && !t.isVaultIdle
        ? t.currentAssets + parsed
        : parsed;
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

export function VaultV2Allocations({ vaultAddress, chainId, preloadedData, preloadedRisk }: VaultV2AllocationsProps) {
  const queryClient = useQueryClient();
  const { data: fetchedRisk, isLoading, error } = useVaultV2Risk(vaultAddress);
  const {
    data: fetchedGov,
    isLoading: govLoading,
    error: govError,
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
        vaultRefRaw += rawAssets;

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

        const underlyingLiquidity = readMarketLiquidity(
          {
            liquidityAssetsUsd: underlying?.liquidityUsd ?? null,
            liquidityAssets: underlying?.liquidityUnderlying ?? null,
          },
          vaultRefUsd,
          vaultRefRaw
        );

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
          liquidity: underlyingLiquidity.usd,
          liquidityAssets: underlyingLiquidity.assets,
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

          let rawAssets = BigInt(0);
          if (allocAssets) { try { rawAssets = BigInt(allocAssets); } catch { /* */ } }
          totalRaw += rawAssets;
          vaultRefRaw += rawAssets;

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
            currentAssets: rawAssets,
            currentUsd: entry.allocationUsd,
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
            morphoHref: morphoMarketHref(marketKey),
            isIdle: !m.lltv,
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
            wrappedVaultVersion: null,
            searchHaystack: `${label} ${allocSym ?? ''} ${formatLltvPill(m.lltv ?? null) ?? ''} morpho blue`.toLowerCase(),
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
  }, [risk, governance]);

  // Attach caps to each target now that `targets` and `capByIdHash` are known.
  const targetsWithCaps: AllocTarget[] = useMemo(() => {
    return targets.map((t) => {
      if (t.isVaultIdle) {
        return { ...t, absoluteCapRaw: null, relativeCapWad: null };
      }
      const marketKey =
        !t.isMetaMorpho && !t.isVaultIdle
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

  const [editing, setEditing] = useState(false);
  const [inputMode, setInputMode] = useState<InputMode>('tokens');
  const [inputValues, setInputValues] = useState<string[]>([]);
  /** Rows where the input is idle to deploy (+current on resolve), set via Max. */
  const [idleDeployRows, setIdleDeployRows] = useState<Set<number>>(() => new Set());
  const [filters, setFilters] = usePersistedAllocationFilters(vaultAddress);
  /** Where unallocated remainder goes: 'auto' = implicit Idle, or a target index. */
  const liquidityAdapterAddress = governance?.liquidityAdapter?.address?.toLowerCase() ?? null;

  const defaultDustRecipientKey = useMemo((): DustRecipientChoice => {
    if (!liquidityAdapterAddress) return 'auto';

    let liquidityDataHex: string | null = null;
    const liquidityData = governance?.liquidityData;
    if (liquidityData?.kind === 'market' && liquidityData.marketParams) {
      try {
        liquidityDataHex = encodeMarketParamsData(liquidityData.marketParams).toLowerCase();
      } catch {
        liquidityDataHex = null;
      }
    } else if (liquidityData?.kind === 'metaMorpho') {
      liquidityDataHex = '0x';
    }

    const idx = targetsWithCaps.findIndex((t) => {
      if (t.isVaultIdle) return false;
      if (t.adapterAddress.toLowerCase() !== liquidityAdapterAddress) return false;
      if (liquidityDataHex && !t.isMetaMorpho) {
        return t.data.toLowerCase() === liquidityDataHex;
      }
      return true;
    });
    return idx >= 0 ? String(idx) : 'auto';
  }, [liquidityAdapterAddress, governance?.liquidityData, targetsWithCaps]);

  const [dustRecipientKey, setDustRecipientKey] = useState<DustRecipientChoice>('auto');
  const [rebalancePreviewOpen, setRebalancePreviewOpen] = useState(false);
  const multicallWrite = useVaultWrite({ chainId });

  useEffect(() => {
    if (!multicallWrite.isSuccess) return;
    void queryClient.refetchQueries({ queryKey: ['vault-v2-risk', vaultAddress] });
    void queryClient.refetchQueries({ queryKey: ['vault-v2-governance', vaultAddress] });
    void queryClient.refetchQueries({ queryKey: ['vault-reallocations', vaultAddress] });
    setRebalancePreviewOpen(false);
  }, [multicallWrite.isSuccess, queryClient, vaultAddress]);

  const startEditing = useCallback(() => {
    setInputMode('tokens');
    setInputValues(targetsWithCaps.map(() => ''));
    setIdleDeployRows(new Set());
    setDustRecipientKey(defaultDustRecipientKey);
    setEditing(true);
  }, [targetsWithCaps, defaultDustRecipientKey]);

  const cancelEditing = useCallback(() => {
    setEditing(false);
    setIdleDeployRows(new Set());
    multicallWrite.reset();
  }, [multicallWrite]);

  const updateInput = useCallback((idx: number, val: string) => {
    setIdleDeployRows((prev) => {
      if (!prev.has(idx)) return prev;
      const next = new Set(prev);
      next.delete(idx);
      return next;
    });
    setInputValues((prev) => prev.map((v, i) => (i === idx ? val : v)));
  }, []);

  const parseInputToRaw = useCallback(
    (idx: number, val: string): bigint => {
      return resolveTargetAssetsFromInput(
        idx,
        val,
        inputMode,
        targetsWithCaps,
        totalRawAssets,
        { parseAsIdleDeploy: idleDeployRows.has(idx) }
      ).assets;
    },
    [inputMode, targetsWithCaps, totalRawAssets, idleDeployRows]
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
      setIdleDeployRows((prev) => {
        if (!prev.has(targetIdx)) return prev;
        const next = new Set(prev);
        next.delete(targetIdx);
        return next;
      });
      updateInput(targetIdx, '0');
    },
    [updateInput]
  );

  const setRowMax = useCallback(
    (targetIdx: number) => {
      const t = targetsWithCaps[targetIdx];
      if (!t) return;

      const idleRaw = vaultIdleRaw(targetsWithCaps);

      if (t.isVaultIdle) {
        setIdleDeployRows((prev) => {
          const next = new Set(prev);
          next.delete(targetIdx);
          return next;
        });
        setInputValues((prev) =>
          prev.map((v, i) =>
            i === targetIdx
              ? inputMode === 'percentage'
                ? (totalRawAssets > BigInt(0)
                    ? Number((idleRaw * BigInt(10000)) / totalRawAssets) / 100
                    : 0
                  ).toFixed(2)
                : formatAllocationEditInputExact(idleRaw, t.symbol, t.decimals, false)
              : v
          )
        );
        return;
      }

      const deploy = idleDeployAmount(t, totalRawAssets, idleRaw);

      setIdleDeployRows((prev) => {
        const next = new Set(prev);
        next.add(targetIdx);
        return next;
      });

      if (inputMode === 'percentage') {
        const pct =
          totalRawAssets > BigInt(0)
            ? Number((deploy * BigInt(10000)) / totalRawAssets) / 100
            : 0;
        setInputValues((prev) => prev.map((v, i) => (i === targetIdx ? pct.toFixed(2) : v)));
        return;
      }

      setInputValues((prev) =>
        prev.map((v, i) =>
          i === targetIdx
            ? formatAllocationEditInputExact(deploy, t.symbol, t.decimals, false)
            : v
        )
      );
    },
    [inputMode, targetsWithCaps, totalRawAssets]
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
        totalRawAssets,
        { parseAsIdleDeploy: idleDeployRows.has(i) }
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
      // Auto (Idle): balance planning sum when every row has an input (0 / Max / typed).
      !overshoot &&
      diff !== BigInt(0) &&
      dustRecipientKey === 'auto' &&
      idleIdx >= 0 &&
      allRowsEdited
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

    const sumAssets = adjustedResults.reduce((s, r) => s + r.assets, BigInt(0));

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

    if (overshoot) {
      return {
        valid: false as const,
        error: `Over-allocated by ${formatRawTokenAmount(-diff, vaultDecimals, vaultDisplayDecimals)} ${vaultSymbol}. Reduce a target.`,
        results: adjustedResults,
        inputSum,
        sumAssets,
        dustDiff,
        dustRecipientIdx,
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
      if (t.absoluteCapRaw != null && r.assets > t.absoluteCapRaw) {
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
      const idleRaw = vaultIdleRaw(targetsWithCaps);
      return {
        valid: false as const,
        error:
          idleRaw > BigInt(0)
            ? 'No adapter allocation changes — use Max on a strategy row to deploy idle, or Zero to withdraw.'
            : 'No adapter allocation changes — idle-only edits do not submit on-chain.',
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
    };
  }, [editing, inputValues, targetsWithCaps, inputMode, totalRawAssets, vaultDecimals, vaultDisplayDecimals, vaultSymbol, dustRecipientKey, governance, govError, idleDeployRows]);

  const handleRebalance = useCallback(async () => {
    if (!resolvedAllocations?.valid) return;

    multicallWrite.reset();

    const deallocCalls: Hex[] = [];
    const allocCalls: Hex[] = [];

    for (const r of resolvedAllocations.results) {
      if (r.target.isVaultIdle) continue;
      if (r.assets === r.current) continue;
      if (r.assets < r.current) {
        const delta =
          r.assets === 0n
            ? r.current
            : clampDeallocateAmount(r.current - r.assets, r.current);
        if (delta <= 0n) continue;
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

    try {
      if (allCalls.length === 1) {
        const r = resolvedAllocations.results.find(
          (r) => !r.target.isVaultIdle && r.assets !== r.current
        )!;
        if (r.assets > r.current) {
          await multicallWrite.write(v2WriteConfigs.allocate(
            vaultAddress as Address,
            r.target.adapterAddress as Address,
            r.target.data,
            r.assets - r.current
          ));
        } else {
          const delta = r.current - r.assets;
          const safeDelta =
            r.assets === 0n ? r.current : clampDeallocateAmount(delta, r.current);
          if (safeDelta <= 0n) return;
          await multicallWrite.write(v2WriteConfigs.deallocate(
            vaultAddress as Address,
            r.target.adapterAddress as Address,
            r.target.data,
            safeDelta
          ));
        }
      } else {
        await multicallWrite.write(v2WriteConfigs.multicall(vaultAddress as Address, allCalls));
      }
    } catch {
      // Error surfaced via multicallWrite.error in TxPreviewDialog
    }
  }, [resolvedAllocations, vaultAddress, multicallWrite]);

  const rebalancePreview = useMemo(() => {
    if (!resolvedAllocations?.valid) return null;
    return buildAllocationRebalancePreview(
      resolvedAllocations.results.map((r) => ({
        label: r.target.label,
        symbol: r.target.symbol,
        decimals: r.target.decimals,
        isVaultIdle: r.target.isVaultIdle,
        currentAssets: r.current,
        assets: r.assets,
      })),
      vaultSymbol
    );
  }, [resolvedAllocations, vaultSymbol]);

  const openRebalancePreview = useCallback(() => {
    if (!rebalancePreview) return;
    setRebalancePreviewOpen(true);
  }, [rebalancePreview]);

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

    let show = true;
    if (filters.onlyIdle && !isIdleRow) show = false;
    if (search && !r.searchHaystack.includes(search)) show = false;
    if (filters.hideZero && t.currentAssets === BigInt(0)) show = false;
    if (filters.hideIdle && isIdleRow) show = false;
    if (filters.onlyWithCapacity) {
      if (t.isVaultIdle || !hasRemainingCapacity(t, totalRawAssets)) show = false;
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
        return compareBigIntAsc(ta.currentAssets, tb.currentAssets);
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
          const h = t.absoluteCapRaw - t.currentAssets;
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
        return compareBigIntDesc(ta.currentAssets, tb.currentAssets);
    }
  });

  const rowsToRender: RowType[] = [];
  for (const idx of sortedTargetIndices) {
    const tr = rows.find((r) => r.targetIdx === idx);
    if (tr) rowsToRender.push(tr);
  }

  const plannedSum = resolvedAllocations?.sumAssets ?? resolvedAllocations?.inputSum ?? BigInt(0);
  const remainingRaw = editing ? totalRawAssets - plannedSum : BigInt(0);
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
    title:
      section.key === 'vault'
        ? rowsToRender.some((r) => r.wrappedVaultVersion === 'v2')
          ? 'V2 Vault'
          : 'V1 Vault'
        : section.title,
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
                totalRawAssets,
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
    const versionPill =
      r.wrappedVaultVersion != null ? (
        <AllocationPill>{r.wrappedVaultVersion.toUpperCase()}</AllocationPill>
      ) : null;

    const allocationAmount = formatRowAllocationCell(r, t, filters);

    const inputWidthCh = allocationInputWidthCh(t.symbol, t.decimals);

    const percentAllocated = (
      <AllocationPctIndicator pct={getRowPercent(r.targetIdx)} />
    );

    const tags = (
      <>
        {versionPill}
        {lltvPill ? <AllocationPill>{lltvPill}</AllocationPill> : null}
      </>
    );

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
        tags={versionPill || lltvPill ? tags : undefined}
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
                    ? 'Set target to current idle balance'
                    : 'Fill with unallocated idle amount (+ current on submit)'
                }
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
                : `${formatRawTokenAmount(totalRawAssets, vaultDecimals, vaultDisplayDecimals)} ${vaultSymbol}`}
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
              <Button variant="outline" size="sm" onClick={startEditing} className="flex items-center gap-1.5">
                <Pencil className="h-3.5 w-3.5" /> Rebalance
              </Button>
            ) : (
              <div className="flex items-center gap-2">
                <div className="flex gap-0.5 rounded-md border p-0.5">
                  <button
                    onClick={() => { setInputMode('percentage'); setInputValues(targetsWithCaps.map(() => '')); setIdleDeployRows(new Set()); }}
                    className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${inputMode === 'percentage' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                  >%</button>
                  <button
                    onClick={() => { setInputMode('tokens'); setInputValues(targetsWithCaps.map(() => '')); setIdleDeployRows(new Set()); }}
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
              onClick={openRebalancePreview}
              disabled={!resolvedAllocations?.valid || !rebalancePreview}
              isLoading={multicallWrite.isLoading}
              isSuccess={multicallWrite.isSuccess}
              error={multicallWrite.error}
              txHash={multicallWrite.txHash}
            />

            <TxPreviewDialog
              open={rebalancePreviewOpen}
              preview={rebalancePreview}
              onOpenChange={setRebalancePreviewOpen}
              onConfirm={handleRebalance}
              isLoading={multicallWrite.isLoading}
              error={multicallWrite.error}
              confirmLabel="Confirm rebalance"
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
