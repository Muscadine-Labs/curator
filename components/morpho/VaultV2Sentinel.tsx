'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useAccount } from 'wagmi';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  CuratorEmptyText,
  CuratorErrorText,
  CuratorKvList,
  CuratorKvRow,
  CuratorPageHeader,
  CuratorPanel,
  CuratorSectionHeader,
  CuratorTableShell,
} from '@/components/morpho/CuratorChrome';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { TransactionButton } from '@/components/TransactionButton';
import { TxPreviewDialog } from '@/components/morpho/TxPreviewDialog';
import { formatLltvPill, formatMarketPairLabel } from '@/components/morpho/AllocationListView';
import { CapLabel } from '@/components/morpho/CapLabel';
import { VaultV2Pending } from '@/components/morpho/VaultV2Pending';
import { useVaultV2Governance, vaultV2GovernanceQueryKey } from '@/lib/hooks/useVaultV2Governance';
import { useVaultV2Risk } from '@/lib/hooks/useVaultV2Risk';
import { useVaultWrite } from '@/lib/hooks/useVaultWrite';
import { isBroadcastTxHash, isWalletRejection } from '@/lib/utils/wallet-error';
import { v2WriteConfigs } from '@/lib/onchain/vault-writes';
import { minTargetFromLiquidity } from '@/lib/onchain/v2-rebalance-plan';
import {
  buildAdapterLabelMap,
  capLltvPill,
  capDisplayLabel,
  capRowKey,
  formatCapRelative,
  formatCapTokenAmount,
  groupCaps,
} from '@/lib/morpho/v2-cap-format';
import {
  EMPTY_ADAPTER_DATA,
  encodeMarketParamsData,
  resolveCapIdData,
} from '@/lib/morpho/v2-id-data';
import { formatFullUSD, formatPercentage, formatRawTokenAmount } from '@/lib/format/number';
import {
  formatAllocationTableAmount,
  formatAllocationEditInputExact,
  parseHumanTokenInput,
  clampDeallocateAmount,
} from '@/lib/format/allocation-display';
import {
  getTokenDisplayDecimals,
  resolveAssetDecimals,
} from '@/lib/format/asset-decimals';
import { marketKeyFromGraphQL, curatorBlueMarketHref, curatorVaultHref } from '@/lib/morpho/morpho-app-links';
import { resolveUnderlyingVaultAddress } from '@/lib/config/vaults';
import { isMorphoVaultV2Adapter } from '@/lib/morpho/vault-v2-adapter';
import type { CapInfo, VaultV2GovernanceResponse } from '@/app/api/vaults/[id]/governance/route';
import type { V2VaultRiskResponse } from '@/app/api/vaults/[id]/risk/route';
import type { VaultV2PendingResponse } from '@/app/api/vaults/[id]/pending/route';
import {
  buildCapDecreasePreview,
  buildDeallocatePreviewResult,
} from '@/lib/morpho/tx-preview';
import { parseCapDecreaseInput } from '@/lib/morpho/cap-decrease-input';
import type { TxPreview } from '@/lib/morpho/tx-preview';
import type { Address, Hex } from 'viem';
import { getAddress } from 'viem';
import { queueSafeTransaction } from '@/lib/safe/queue-vault-write';
import { getConnectorProvider } from '@/lib/wallet/connector-provider';
import { useCuratorSafeApps } from '@/lib/safe/safe-apps-context';
import type { SafeRole } from '@/lib/safe/config';
import { SENTINEL_SAFE_ROLE } from '@/lib/safe/config';
import {
  defaultSentinelDestination,
  eligibleSafeRolesForAddresses,
  canConfirmVaultWriteDestination,
  coerceVaultWriteDestination,
  walletCanSignSentinel,
  type VaultWriteDestination,
} from '@/lib/safe/vault-write-destination';
import { vaultWriteToCalldata } from '@/lib/safe/encode-vault-write';

interface VaultV2SentinelProps {
  vaultAddress: string;
  chainId: number;
  preloadedGovernance?: VaultV2GovernanceResponse | null;
  preloadedRisk?: V2VaultRiskResponse | null;
  preloadedPending?: VaultV2PendingResponse | null;
  assetSymbol?: string | null;
  assetDecimals?: number | null;
  emergencyActionsUrl?: string;
}

type DeallocateRow = {
  key: string;
  label: string;
  morphoHref: string | null;
  lltv: string | null;
  adapterAddress: string;
  idData: Hex;
  currentRaw: bigint;
  /** Market withdrawable liquidity (raw loan assets); used for Min deallocate. */
  liquidityAssets: bigint | null;
  allocationPct: number;
  supplyApy: number | null;
  liquidityUsd: number | null;
  absoluteCap: string | null;
  relativeCap: string | null;
  canDeallocate: boolean;
};

type OverviewSegment = {
  key: string;
  label: string;
  morphoHref: string | null;
  pct: number;
  raw: bigint;
  color: string;
};

type CapDecreaseMode = 'absolute' | 'relative';

const BAR_COLORS = [
  'bg-blue-500',
  'bg-indigo-500',
  'bg-violet-500',
  'bg-sky-500',
  'bg-cyan-500',
  'bg-teal-500',
];

const morphoLinkClass =
  'truncate text-blue-600 hover:underline dark:text-blue-400';

function SentinelAllocationLabel({
  label,
  morphoHref,
  className,
}: {
  label: string;
  morphoHref: string | null;
  className?: string;
}) {
  if (!morphoHref) {
    return (
      <span className={className ?? 'truncate text-foreground'}>{label}</span>
    );
  }
  return (
    <a
      href={morphoHref}
      target="_blank"
      rel="noopener noreferrer"
      className={[morphoLinkClass, className].filter(Boolean).join(' ')}
    >
      {label}
    </a>
  );
}

export function VaultV2Sentinel({
  vaultAddress,
  chainId,
  preloadedGovernance,
  preloadedRisk,
  preloadedPending,
  assetSymbol,
  assetDecimals,
  emergencyActionsUrl,
}: VaultV2SentinelProps) {
  const { data: fetchedGov, isLoading: govLoading } = useVaultV2Governance(vaultAddress, {
    initialData: preloadedGovernance ?? undefined,
  });
  const { data: fetchedRisk, isLoading: riskLoading } = useVaultV2Risk(vaultAddress, {
    initialData: preloadedRisk ?? undefined,
  });
  const governance = fetchedGov ?? preloadedGovernance;
  const risk = fetchedRisk ?? preloadedRisk;

  const chainDecimals = resolveAssetDecimals(assetSymbol ?? undefined, assetDecimals ?? undefined);
  const displayDecimals = getTokenDisplayDecimals(assetSymbol ?? undefined, chainDecimals);

  const { totalRaw, overviewSegments, deallocateRows } = useMemo(() => {
    if (!risk) {
      return { totalRaw: 0n, overviewSegments: [] as OverviewSegment[], deallocateRows: [] as DeallocateRow[] };
    }
    return buildOverviewAndDeallocate(risk, governance, vaultAddress, chainId);
  }, [risk, governance, vaultAddress, chainId]);

  if ((!preloadedGovernance && govLoading) || (!preloadedRisk && riskLoading)) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (!governance || !risk) {
    return (
      <div className="space-y-6">
        <CuratorPageHeader title="Sentinel" />
        <CuratorErrorText>Failed to load sentinel data.</CuratorErrorText>
      </div>
    );
  }

  const adapterLabels = buildAdapterLabelMap(governance.adapters);
  const grouped = groupCaps(governance.caps);

  return (
    <div className="space-y-6">
      <CuratorPageHeader
        title="Sentinel"
        description="Deallocate to idle, decrease caps, and revoke pending curator actions."
      />

      <CuratorPanel title="Allocation overview">
        <CuratorKvList>
          <CuratorKvRow label="Total assets">
            {formatAllocationTableAmount(totalRaw, assetSymbol, assetDecimals ?? chainDecimals)}
          </CuratorKvRow>
        </CuratorKvList>
        <div className="space-y-4 px-4 py-3">
          <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
            {overviewSegments.map((seg, i) =>
              seg.pct > 0 ? (
                <div
                  key={seg.key}
                  className={`${BAR_COLORS[i % BAR_COLORS.length]} transition-all`}
                  style={{ width: `${Math.max(seg.pct, 0.5)}%` }}
                  title={`${seg.label} ${seg.pct.toFixed(1)}%`}
                />
              ) : null
            )}
          </div>
          <div className="space-y-2">
            {overviewSegments.map((seg, i) => (
              <div key={seg.key} className="flex items-center justify-between gap-3 text-sm">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${BAR_COLORS[i % BAR_COLORS.length]}`}
                  />
                  <SentinelAllocationLabel label={seg.label} morphoHref={seg.morphoHref} />
                </div>
                <div className="flex shrink-0 items-center gap-4 tabular-nums text-muted-foreground">
                  <span>
                    {formatAllocationTableAmount(seg.raw, assetSymbol, assetDecimals ?? chainDecimals)}
                  </span>
                  <span className="w-14 text-right">{seg.pct.toFixed(1)}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </CuratorPanel>

      <CuratorPanel
        title="Pending actions"
        description="Pending timelock actions submitted by the curator. Revoke cancels before execution — sentinel or curator wallet/Safe (sentinel preferred)."
      >
        <div className="px-4 py-3">
          <VaultV2Pending
            vaultAddress={vaultAddress}
            chainId={chainId}
            preloadedData={preloadedPending}
            preloadedGovernance={governance}
            preloadedRisk={risk}
            assetSymbol={assetSymbol}
            assetDecimals={assetDecimals}
            vaultSymbol={assetSymbol ?? undefined}
            embedded
            sentinelEmpty
            allowRevoke
          />
        </div>
      </CuratorPanel>

      <DecreaseCapsPanel
        grouped={grouped}
        risk={risk}
        adapterLabels={adapterLabels}
        vaultAddress={vaultAddress}
        chainId={chainId}
        assetSymbol={assetSymbol}
        assetDecimals={assetDecimals}
        chainDecimals={chainDecimals}
        sentinels={governance.sentinels}
      />

      <DeallocatePanel
        rows={deallocateRows}
        vaultAddress={vaultAddress}
        chainId={chainId}
        assetSymbol={assetSymbol}
        assetDecimals={assetDecimals}
        chainDecimals={chainDecimals}
        displayDecimals={displayDecimals}
        sentinels={governance.sentinels}
      />

      {emergencyActionsUrl ? (
        <section className="space-y-3">
          <CuratorSectionHeader
            title="Emergency actions"
            description="Close deposits, hard/safe market removal, sentinel lockdown, and allocator compromised flows on Morpho Curator."
          />
          <CuratorPanel>
            <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">
                Execute emergency actions for this vault on Morpho Curator.
              </p>
              <Button variant="outline" asChild>
                <a href={emergencyActionsUrl} target="_blank" rel="noopener noreferrer">
                  Open Emergency Actions
                </a>
              </Button>
            </div>
          </CuratorPanel>
        </section>
      ) : null}
    </div>
  );
}

function DecreaseCapsPanel({
  grouped,
  risk,
  adapterLabels,
  vaultAddress,
  chainId,
  assetSymbol,
  assetDecimals,
  chainDecimals,
  sentinels,
}: {
  grouped: ReturnType<typeof groupCaps>;
  risk: V2VaultRiskResponse;
  adapterLabels: Map<string, string>;
  vaultAddress: string;
  chainId: number;
  assetSymbol?: string | null;
  assetDecimals?: number | null;
  chainDecimals: number;
  sentinels: string[];
}) {
  const [selections, setSelections] = useState<Record<string, CapDecreaseMode>>({});
  const [newValues, setNewValues] = useState<Record<string, string>>({});
  const [activeRowKey, setActiveRowKey] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [txPreview, setTxPreview] = useState<TxPreview | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [queueingSafe, setQueueingSafe] = useState(false);
  const [queueSafeError, setQueueSafeError] = useState<string | null>(null);
  const [writeDestination, setWriteDestination] = useState<VaultWriteDestination>(() =>
    defaultSentinelDestination(sentinels, undefined)
  );
  const pendingConfirmRef = useRef<(() => Promise<void>) | null>(null);
  const pendingCalldataRef = useRef<{ to: Address; data: Hex } | null>(null);
  const queryClient = useQueryClient();
  const router = useRouter();
  const { address: walletAddress, isConnected, connector } = useAccount();
  const { connected: safeAppConnected, sdk: safeAppSdk, safeRole: safeAppRole } =
    useCuratorSafeApps();
  const sentinelSafeAppSdk = useMemo(
    () =>
      safeAppConnected &&
      safeAppSdk &&
      writeDestination.kind === 'safe' &&
      safeAppRole === writeDestination.role
        ? safeAppSdk
        : null,
    [safeAppConnected, safeAppSdk, safeAppRole, writeDestination]
  );

  const walletCanUseSentinel = walletCanSignSentinel(walletAddress, sentinels);
  const walletReady = isConnected && walletCanUseSentinel;
  const sentinelWalletHint = !isConnected
    ? 'Connect your wallet in the top bar to sign directly with your EOA.'
    : !walletCanUseSentinel
      ? 'Connected wallet is not an on-chain sentinel for this vault — switch to a sentinel EOA or queue to a Safe.'
      : undefined;
  const eligibleSentinelSafes = useMemo(
    () => eligibleSafeRolesForAddresses(sentinels),
    [sentinels]
  );
  const write = useVaultWrite({ chainId });
  const writeInFlight = write.isLoading && activeRowKey !== null;

  useEffect(() => {
    if (!write.isSuccess) return;
    void queryClient.refetchQueries({ queryKey: ['vault-v2-risk', vaultAddress] });
    void queryClient.refetchQueries({ queryKey: vaultV2GovernanceQueryKey(vaultAddress) });
    void queryClient.refetchQueries({ queryKey: ['vault-reallocations', vaultAddress] });
    void queryClient.refetchQueries({ queryKey: ['vault', vaultAddress] });
    setPreviewOpen(false);
    setTxPreview(null);
    pendingConfirmRef.current = null;
    pendingCalldataRef.current = null;
    setActiveRowKey(null);
  }, [write.isSuccess, queryClient, vaultAddress]);

  const beginWrite = useCallback(
    async (rowKey: string, config: Parameters<typeof write.write>[0]) => {
      write.reset();
      setActiveRowKey(rowKey);
      try {
        await write.write(config);
      } catch (e) {
        setActiveRowKey(null);
        if (isWalletRejection(e)) return;
        setRowErrors((prev) => ({
          ...prev,
          [rowKey]: e instanceof Error ? e.message : 'Failed to submit transaction.',
        }));
      }
    },
    [write]
  );

  const setSelection = (rowKey: string, mode: CapDecreaseMode) => {
    setSelections((prev) => ({ ...prev, [rowKey]: mode }));
    setRowErrors((prev) => {
      if (!prev[rowKey]) return prev;
      const next = { ...prev };
      delete next[rowKey];
      return next;
    });
  };

  const submitRowDecrease = useCallback(
    async (rowKey: string, mode: CapDecreaseMode, valueStr: string) => {
      const cap = findCapByRowKey(rowKey, grouped);
      if (!cap) {
        setRowErrors((prev) => ({ ...prev, [rowKey]: 'Cap row not found.' }));
        return;
      }
      const idData = resolveCapIdData(cap, risk);
      if (!idData) {
        setRowErrors((prev) => ({
          ...prev,
          [rowKey]: 'Cap idData unavailable — cannot submit decrease.',
        }));
        return;
      }

      const parsed = parseCapDecreaseInput({
        mode,
        valueStr,
        currentAbsoluteRaw: cap.absoluteCap,
        currentRelativeRaw: cap.relativeCap,
        assetSymbol,
        chainDecimals,
      });
      if (!parsed.ok) {
        setRowErrors((prev) => ({ ...prev, [rowKey]: parsed.error }));
        return;
      }

      if (parsed.mode === 'absolute') {
        await beginWrite(
          rowKey,
          v2WriteConfigs.decreaseAbsoluteCap(vaultAddress as Address, idData, parsed.value)
        );
        return;
      }

      await beginWrite(
        rowKey,
        v2WriteConfigs.decreaseRelativeCap(vaultAddress as Address, idData, parsed.value)
      );
    },
    [assetSymbol, beginWrite, chainDecimals, grouped, risk, vaultAddress]
  );

  const requestRowDecrease = useCallback(
    (rowKey: string, mode: CapDecreaseMode, valueStr: string) => {
      const cap = findCapByRowKey(rowKey, grouped);
      if (!cap) {
        setRowErrors((prev) => ({ ...prev, [rowKey]: 'Cap row not found.' }));
        return;
      }
      if (!resolveCapIdData(cap, risk)) {
        setRowErrors((prev) => ({
          ...prev,
          [rowKey]: 'Cap idData unavailable — cannot submit decrease.',
        }));
        return;
      }

      const label = capDisplayLabel(cap, risk, adapterLabels);
      const result = buildCapDecreasePreview({
        cap,
        capLabel: label,
        mode,
        currentAbsoluteRaw: cap.absoluteCap,
        currentRelativeRaw: cap.relativeCap,
        newValueStr: valueStr,
        assetSymbol,
        assetDecimals,
        chainDecimals,
      });
      if (!result.ok) {
        setRowErrors((prev) => ({ ...prev, [rowKey]: result.error }));
        return;
      }

      const idData = resolveCapIdData(cap, risk);
      if (!idData) return;

      const parsed = parseCapDecreaseInput({
        mode,
        valueStr,
        currentAbsoluteRaw: cap.absoluteCap,
        currentRelativeRaw: cap.relativeCap,
        assetSymbol,
        chainDecimals,
      });
      if (!parsed.ok) return;

      const writeConfig =
        parsed.mode === 'absolute'
          ? v2WriteConfigs.decreaseAbsoluteCap(
              vaultAddress as Address,
              idData,
              parsed.value
            )
          : v2WriteConfigs.decreaseRelativeCap(
              vaultAddress as Address,
              idData,
              parsed.value
            );

      pendingCalldataRef.current = vaultWriteToCalldata({
        address: writeConfig.address,
        functionName: writeConfig.functionName,
        args: writeConfig.args,
      });

      setRowErrors((prev) => {
        if (!prev[rowKey]) return prev;
        const next = { ...prev };
        delete next[rowKey];
        return next;
      });
      pendingConfirmRef.current = () => submitRowDecrease(rowKey, mode, valueStr);
      setTxPreview(result.preview);
      setWriteDestination(
        coerceVaultWriteDestination(
          defaultSentinelDestination(sentinels, walletAddress),
          {
            eligibleSafeRoles: eligibleSafeRolesForAddresses(sentinels),
            preferredSafeRole: SENTINEL_SAFE_ROLE,
          }
        )
      );
      setPreviewOpen(true);
    },
    [adapterLabels, assetDecimals, assetSymbol, chainDecimals, grouped, risk, sentinels, submitRowDecrease, vaultAddress, walletAddress]
  );

  const confirmPreview = useCallback(async () => {
    try {
      await pendingConfirmRef.current?.();
    } catch (e) {
      if (activeRowKey) {
        setRowErrors((prev) => ({
          ...prev,
          [activeRowKey]: e instanceof Error ? e.message : 'Failed to submit transaction.',
        }));
      }
    }
  }, [activeRowKey]);

  const handleQueueInSafe = useCallback(
    async (safeRole: SafeRole, description: string, source: Parameters<typeof queueSafeTransaction>[0]['source']) => {
      if (!txPreview || !pendingCalldataRef.current) return;

      setQueueingSafe(true);
      setQueueSafeError(null);

      try {
        await queueSafeTransaction({
          safeRole,
          calldata: pendingCalldataRef.current,
          description,
          preview: txPreview,
          source,
          proposer: walletAddress ? getAddress(walletAddress) : undefined,
          provider: await getConnectorProvider(connector),
          safeAppSdk: sentinelSafeAppSdk,
        });
        setPreviewOpen(false);
        setTxPreview(null);
        pendingConfirmRef.current = null;
        pendingCalldataRef.current = null;
        router.push(`/safe/${safeRole}/transactions`);
      } catch (error) {
        setQueueSafeError(
          error instanceof Error ? error.message : 'Failed to queue Safe transaction.'
        );
      } finally {
        setQueueingSafe(false);
      }
    },
    [router, sentinelSafeAppSdk, txPreview, walletAddress, connector]
  );

  const handlePreviewConfirm = useCallback(async () => {
    if (
      !canConfirmVaultWriteDestination(writeDestination, {
        walletReady,
        eligibleSafeRoles: eligibleSentinelSafes,
      })
    ) {
      if (writeDestination.kind === 'wallet') {
        setRowErrors((prev) => ({
          ...prev,
          ...(activeRowKey
            ? {
                [activeRowKey]:
                  sentinelWalletHint ??
                  'Connect a sentinel wallet in the top bar, or queue to a role multisig.',
              }
            : {}),
        }));
      } else {
        setQueueSafeError('Selected Safe is not an on-chain sentinel for this vault.');
      }
      return;
    }

    if (writeDestination.kind === 'safe') {
      await handleQueueInSafe(
        writeDestination.role,
        `Sentinel cap decrease — ${assetSymbol ?? vaultAddress}`,
        {
          type: 'sentinel',
          action: 'decrease_cap',
          vaultAddress: getAddress(vaultAddress),
          vaultSymbol: assetSymbol ?? undefined,
        }
      );
      return;
    }
    await confirmPreview();
  }, [
    writeDestination,
    walletReady,
    sentinelWalletHint,
    eligibleSentinelSafes,
    handleQueueInSafe,
    assetSymbol,
    vaultAddress,
    confirmPreview,
    activeRowKey,
  ]);

  const clearRowInput = (rowKey: string) => {
    setSelections((prev) => {
      const next = { ...prev };
      delete next[rowKey];
      return next;
    });
    setNewValues((prev) => {
      const next = { ...prev };
      delete next[rowKey];
      return next;
    });
    setRowErrors((prev) => {
      if (!prev[rowKey]) return prev;
      const next = { ...prev };
      delete next[rowKey];
      return next;
    });
  };

  const setPresetZero = (rowKey: string, mode: CapDecreaseMode) => {
    setSelection(rowKey, mode);
    setNewValues((prev) => ({ ...prev, [rowKey]: '0' }));
  };

  const sections: Array<{
    title: string;
    description: string;
    caps: CapInfo[];
    nameCol: string;
    showLltv?: boolean;
  }> = [
    {
      title: 'Adapter Caps',
      description: 'Limit the amount of assets that can be allocated to positions using specific adapters.',
      caps: grouped.adapter,
      nameCol: 'Adapter',
    },
    {
      title: 'Collateral Token Caps',
      description:
        'Limit the amount of assets that can be allocated to positions using specific collateral tokens.',
      caps: grouped.collateral,
      nameCol: 'Collateral',
    },
    {
      title: 'Market Caps',
      description: 'Limit the amount of assets that can be allocated to specific Morpho markets.',
      caps: grouped.market,
      nameCol: 'Market',
      showLltv: true,
    },
  ];

  const totalCaps =
    grouped.adapter.length + grouped.collateral.length + grouped.market.length;

  return (
    <div className="space-y-6">
      <CuratorSectionHeader
        title="Decrease caps"
        description="Pick absolute or relative cap, enter a new value (must be ≤ current), then Decrease. Use 0 to preset zero; Clear resets the row input."
      />
      {totalCaps === 0 ? (
        <CuratorEmptyText>No caps configured.</CuratorEmptyText>
      ) : (
        <div className="space-y-8">
          {sections.map((section) =>
            section.caps.length === 0 ? null : (
              <div key={section.title} className="space-y-3">
                <CuratorSectionHeader
                  title={section.title}
                  count={section.caps.length}
                  description={section.description}
                />
                <CuratorTableShell>
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead>{section.nameCol}</TableHead>
                        <TableHead className="text-right">Allocation</TableHead>
                        <TableHead className="text-right">Absolute Cap</TableHead>
                        <TableHead className="text-right">Relative Cap</TableHead>
                        <TableHead className="min-w-[200px]">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {section.caps.map((cap, idx) => {
                        const rowKey = capRowKey(cap, idx);
                        const label = capDisplayLabel(cap, risk, adapterLabels);
                        const lltv =
                          section.showLltv && cap.marketKey ? capLltvPill(cap, risk) : null;
                        const idData = resolveCapIdData(cap, risk);
                        const mode = selections[rowKey] ?? null;
                        const isActiveRow = activeRowKey === rowKey;
                        const isOtherRowBusy = writeInFlight && !isActiveRow;

                        return (
                          <TableRow key={rowKey}>
                            <TableCell>
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-medium">
                                  <CapLabel cap={cap} label={label} chainId={chainId} />
                                </span>
                                {lltv && (
                                  <Badge variant="outline" className="text-xs">
                                    {lltv}
                                  </Badge>
                                )}
                              </div>
                              {!idData && (
                                <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                                  idData unavailable
                                </p>
                              )}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatCapTokenAmount(cap.allocation, assetSymbol, assetDecimals)}
                            </TableCell>
                            <TableCell className="text-right">
                              <label className="inline-flex cursor-pointer items-center justify-end gap-2 tabular-nums">
                                <input
                                  type="radio"
                                  name={`cap-mode-${rowKey}`}
                                  checked={mode === 'absolute'}
                                  disabled={!idData}
                                  onChange={() => setSelection(rowKey, 'absolute')}
                                  className="h-4 w-4 accent-blue-600"
                                />
                                {formatCapTokenAmount(cap.absoluteCap, assetSymbol, assetDecimals)}
                              </label>
                            </TableCell>
                            <TableCell className="text-right">
                              <label className="inline-flex cursor-pointer items-center justify-end gap-2 tabular-nums">
                                <input
                                  type="radio"
                                  name={`cap-mode-${rowKey}`}
                                  checked={mode === 'relative'}
                                  disabled={!idData}
                                  onChange={() => setSelection(rowKey, 'relative')}
                                  className="h-4 w-4 accent-blue-600"
                                />
                                {formatCapRelative(cap.relativeCap)}
                              </label>
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col gap-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <Input
                                  type="text"
                                  className="h-8 min-w-[90px] flex-1"
                                  placeholder={mode === 'relative' ? '0–100' : 'New cap'}
                                  value={newValues[rowKey] ?? ''}
                                  disabled={!mode || !idData || isOtherRowBusy}
                                  onChange={(e) => {
                                    const value = e.target.value;
                                    setNewValues((prev) => ({ ...prev, [rowKey]: value }));
                                    setRowErrors((prev) => {
                                      if (!prev[rowKey]) return prev;
                                      const next = { ...prev };
                                      delete next[rowKey];
                                      return next;
                                    });
                                  }}
                                />
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  disabled={!idData || isOtherRowBusy}
                                  onClick={() => setPresetZero(rowKey, mode ?? 'absolute')}
                                >
                                  0
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  disabled={!idData || isOtherRowBusy}
                                  onClick={() => clearRowInput(rowKey)}
                                >
                                  Clear
                                </Button>
                                <TransactionButton
                                  label="Decrease"
                                  size="sm"
                                  suppressConnectPrompt
                                  disabled={
                                    !idData ||
                                    !mode ||
                                    !(newValues[rowKey]?.trim()) ||
                                    isOtherRowBusy
                                  }
                                  onClick={() =>
                                    mode &&
                                    requestRowDecrease(rowKey, mode, newValues[rowKey] ?? '')
                                  }
                                  isLoading={isActiveRow && write.isLoading}
                                  isSuccess={isActiveRow && write.isSuccess}
                                  error={isActiveRow ? write.error : null}
                                  txHash={isActiveRow ? write.txHash : undefined}
                                />
                              </div>
                              {rowErrors[rowKey] && (
                                <p className="text-xs text-red-600 dark:text-red-400">{rowErrors[rowKey]}</p>
                              )}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </CuratorTableShell>
              </div>
            )
          )}
        </div>
      )}
      <TxPreviewDialog
        open={previewOpen}
        preview={txPreview}
        onOpenChange={(open) => {
          if (!open && ((writeInFlight && isBroadcastTxHash(write.txHash)) || queueingSafe)) {
            return;
          }
          setPreviewOpen(open);
          if (!open) {
            setTxPreview(null);
            pendingConfirmRef.current = null;
            pendingCalldataRef.current = null;
            setQueueSafeError(null);
            if (!isBroadcastTxHash(write.txHash)) write.reset();
          }
        }}
        destinationOptions={{
          destination: writeDestination,
          onDestinationChange: setWriteDestination,
          walletReady,
          walletHint: sentinelWalletHint,
          safeRoles: eligibleSentinelSafes,
          confirmEnabled: canConfirmVaultWriteDestination(writeDestination, {
            walletReady,
            eligibleSafeRoles: eligibleSentinelSafes,
          }),
        }}
        onConfirm={() => handlePreviewConfirm()}
        isLoading={writeDestination.kind === 'safe' ? queueingSafe : writeInFlight}
        error={
          writeDestination.kind === 'safe'
            ? queueSafeError
              ? new Error(queueSafeError)
              : null
            : write.error
        }
      />
    </div>
  );
}

function DeallocatePanel({
  rows,
  vaultAddress,
  chainId,
  assetSymbol,
  assetDecimals,
  chainDecimals,
  displayDecimals,
  sentinels,
}: {
  rows: DeallocateRow[];
  vaultAddress: string;
  chainId: number;
  assetSymbol?: string | null;
  assetDecimals?: number | null;
  chainDecimals: number;
  displayDecimals: number;
  sentinels: string[];
}) {
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [activeRowKey, setActiveRowKey] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [txPreview, setTxPreview] = useState<TxPreview | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [queueingSafe, setQueueingSafe] = useState(false);
  const [queueSafeError, setQueueSafeError] = useState<string | null>(null);
  const [writeDestination, setWriteDestination] = useState<VaultWriteDestination>(() =>
    defaultSentinelDestination(sentinels, undefined)
  );
  const pendingConfirmRef = useRef<(() => Promise<void>) | null>(null);
  const pendingCalldataRef = useRef<{ to: Address; data: Hex } | null>(null);
  const queryClient = useQueryClient();
  const router = useRouter();
  const { address: walletAddress, isConnected, connector } = useAccount();
  const { connected: safeAppConnected, sdk: safeAppSdk, safeRole: safeAppRole } =
    useCuratorSafeApps();
  const sentinelSafeAppSdk = useMemo(
    () =>
      safeAppConnected &&
      safeAppSdk &&
      writeDestination.kind === 'safe' &&
      safeAppRole === writeDestination.role
        ? safeAppSdk
        : null,
    [safeAppConnected, safeAppSdk, safeAppRole, writeDestination]
  );

  const walletCanUseSentinel = walletCanSignSentinel(walletAddress, sentinels);
  const walletReady = isConnected && walletCanUseSentinel;
  const sentinelWalletHint = !isConnected
    ? 'Connect your wallet in the top bar to sign directly with your EOA.'
    : !walletCanUseSentinel
      ? 'Connected wallet is not an on-chain sentinel for this vault — switch to a sentinel EOA or queue to a Safe.'
      : undefined;
  const eligibleSentinelSafes = useMemo(
    () => eligibleSafeRolesForAddresses(sentinels),
    [sentinels]
  );
  const write = useVaultWrite({ chainId });
  const writeInFlight = write.isLoading && activeRowKey !== null;

  useEffect(() => {
    if (!write.isSuccess) return;
    void queryClient.refetchQueries({ queryKey: ['vault-v2-risk', vaultAddress] });
    void queryClient.refetchQueries({ queryKey: vaultV2GovernanceQueryKey(vaultAddress) });
    void queryClient.refetchQueries({ queryKey: ['vault-reallocations', vaultAddress] });
    void queryClient.refetchQueries({ queryKey: ['vault', vaultAddress] });
    setPreviewOpen(false);
    setTxPreview(null);
    pendingConfirmRef.current = null;
    pendingCalldataRef.current = null;
    setActiveRowKey(null);
  }, [write.isSuccess, queryClient, vaultAddress]);

  const beginWrite = useCallback(
    async (rowKey: string, config: Parameters<typeof write.write>[0]) => {
      write.reset();
      setActiveRowKey(rowKey);
      try {
        await write.write(config);
      } catch (e) {
        setActiveRowKey(null);
        if (isWalletRejection(e)) return;
        setRowErrors((prev) => ({
          ...prev,
          [rowKey]: e instanceof Error ? e.message : 'Failed to submit transaction.',
        }));
      }
    },
    [write]
  );

  const setAmount = (key: string, value: string) => {
    setAmounts((prev) => ({ ...prev, [key]: value }));
    setRowErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  /** Fill deallocate amount with withdrawable liquidity (Allocations Min semantics). */
  const setRowMinDeallocate = (row: DeallocateRow) => {
    if (!row.canDeallocate || row.currentRaw === 0n) return;
    const minTarget = minTargetFromLiquidity(row.currentRaw, row.liquidityAssets);
    const amount = row.currentRaw > minTarget ? row.currentRaw - minTarget : 0n;
    if (amount <= 0n) return;
    setAmount(
      row.key,
      formatAllocationEditInputExact(amount, assetSymbol, assetDecimals ?? chainDecimals)
    );
  };

  const deallocateRow = useCallback(
    async (row: DeallocateRow, amountRaw: bigint) => {
      if (!row.canDeallocate || row.currentRaw === 0n || amountRaw <= 0n) return;
      await beginWrite(
        row.key,
        v2WriteConfigs.deallocate(
          vaultAddress as Address,
          row.adapterAddress as Address,
          row.idData,
          amountRaw
        )
      );
    },
    [beginWrite, vaultAddress]
  );

  const requestDeallocate = useCallback(
    (row: DeallocateRow) => {
      if (!row.canDeallocate || row.currentRaw === 0n) return;
      const rawInput = amounts[row.key]?.trim();
      if (!rawInput) {
        setRowErrors((prev) => ({ ...prev, [row.key]: 'Enter an amount to deallocate.' }));
        return;
      }
      let parsed: bigint;
      try {
        parsed = parseHumanTokenInput(rawInput, assetSymbol, chainDecimals);
      } catch {
        setRowErrors((prev) => ({ ...prev, [row.key]: 'Invalid token amount.' }));
        return;
      }
      parsed = clampDeallocateAmount(parsed, row.currentRaw);
      const minTarget = minTargetFromLiquidity(row.currentRaw, row.liquidityAssets);
      const maxWithdrawable =
        row.currentRaw > minTarget ? row.currentRaw - minTarget : 0n;
      if (parsed > maxWithdrawable) {
        parsed = maxWithdrawable;
      }
      if (parsed <= 0n) {
        setRowErrors((prev) => ({
          ...prev,
          [row.key]:
            maxWithdrawable <= 0n
              ? 'Not enough market liquidity to deallocate. Wait for borrowers to repay, or Min if any amount is withdrawable.'
              : 'Amount must be greater than zero.',
        }));
        return;
      }

      const result = buildDeallocatePreviewResult({
        label: row.label,
        lltv: row.lltv,
        amountRaw: parsed,
        currentRaw: row.currentRaw,
        symbol: assetSymbol,
        chainDecimals,
        assetDecimals,
      });
      if (!result.ok) {
        setRowErrors((prev) => ({ ...prev, [row.key]: result.error }));
        return;
      }

      setRowErrors((prev) => {
        if (!prev[row.key]) return prev;
        const next = { ...prev };
        delete next[row.key];
        return next;
      });

      const writeConfig = v2WriteConfigs.deallocate(
        vaultAddress as Address,
        row.adapterAddress as Address,
        row.idData,
        parsed
      );
      pendingCalldataRef.current = vaultWriteToCalldata({
        address: writeConfig.address,
        functionName: writeConfig.functionName,
        args: writeConfig.args,
      });

      pendingConfirmRef.current = () => deallocateRow(row, parsed);
      setTxPreview(result.preview);
      setWriteDestination(
        coerceVaultWriteDestination(
          defaultSentinelDestination(sentinels, walletAddress),
          {
            eligibleSafeRoles: eligibleSafeRolesForAddresses(sentinels),
            preferredSafeRole: SENTINEL_SAFE_ROLE,
          }
        )
      );
      setPreviewOpen(true);
    },
    [amounts, assetDecimals, assetSymbol, chainDecimals, deallocateRow, sentinels, vaultAddress, walletAddress]
  );

  const confirmPreview = useCallback(async () => {
    try {
      await pendingConfirmRef.current?.();
    } catch (e) {
      if (activeRowKey) {
        setRowErrors((prev) => ({
          ...prev,
          [activeRowKey]: e instanceof Error ? e.message : 'Failed to submit transaction.',
        }));
      }
    }
  }, [activeRowKey]);

  const handleQueueInSafe = useCallback(
    async (safeRole: SafeRole, description: string, source: Parameters<typeof queueSafeTransaction>[0]['source']) => {
      if (!txPreview || !pendingCalldataRef.current) return;

      setQueueingSafe(true);
      setQueueSafeError(null);

      try {
        await queueSafeTransaction({
          safeRole,
          calldata: pendingCalldataRef.current,
          description,
          preview: txPreview,
          source,
          proposer: walletAddress ? getAddress(walletAddress) : undefined,
          provider: await getConnectorProvider(connector),
          safeAppSdk: sentinelSafeAppSdk,
        });
        setPreviewOpen(false);
        setTxPreview(null);
        pendingConfirmRef.current = null;
        pendingCalldataRef.current = null;
        router.push(`/safe/${safeRole}/transactions`);
      } catch (error) {
        setQueueSafeError(
          error instanceof Error ? error.message : 'Failed to queue Safe transaction.'
        );
      } finally {
        setQueueingSafe(false);
      }
    },
    [router, sentinelSafeAppSdk, txPreview, walletAddress, connector]
  );

  const handlePreviewConfirm = useCallback(async () => {
    if (
      !canConfirmVaultWriteDestination(writeDestination, {
        walletReady,
        eligibleSafeRoles: eligibleSentinelSafes,
      })
    ) {
      if (writeDestination.kind === 'wallet') {
        setRowErrors((prev) => ({
          ...prev,
          ...(activeRowKey
            ? {
                [activeRowKey]:
                  sentinelWalletHint ??
                  'Connect a sentinel wallet in the top bar, or queue to a role multisig.',
              }
            : {}),
        }));
      } else {
        setQueueSafeError('Selected Safe is not an on-chain sentinel for this vault.');
      }
      return;
    }

    if (writeDestination.kind === 'safe') {
      await handleQueueInSafe(
        writeDestination.role,
        `Sentinel deallocate — ${assetSymbol ?? vaultAddress}`,
        {
          type: 'sentinel',
          action: 'deallocate',
          vaultAddress: getAddress(vaultAddress),
          vaultSymbol: assetSymbol ?? undefined,
        }
      );
      return;
    }
    await confirmPreview();
  }, [
    writeDestination,
    walletReady,
    sentinelWalletHint,
    eligibleSentinelSafes,
    handleQueueInSafe,
    assetSymbol,
    vaultAddress,
    confirmPreview,
    activeRowKey,
  ]);

  return (
    <div className="space-y-3">
      <CuratorSectionHeader
        title="Deallocate to idle"
        description="Enter an amount and Deallocate, or Min to fill the withdrawable amount (allocation minus illiquid remainder — same liquidity rule as Allocations Min)."
      />
      <CuratorTableShell>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Allocation</TableHead>
              <TableHead className="text-right">Allocation</TableHead>
              <TableHead className="text-right">Effective Abs. Cap</TableHead>
              <TableHead className="text-right">Effective Rel. Cap</TableHead>
              <TableHead className="text-right">Rate</TableHead>
              <TableHead className="text-right">Liquidity</TableHead>
              <TableHead className="min-w-[220px]">Amount</TableHead>
            </TableRow>
          </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    No positions.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => {
                  const minTarget = minTargetFromLiquidity(row.currentRaw, row.liquidityAssets);
                  const minDeallocate =
                    row.currentRaw > minTarget ? row.currentRaw - minTarget : 0n;
                  const amountPlaceholder =
                    minDeallocate > 0n
                      ? formatRawTokenAmount(minDeallocate, chainDecimals, displayDecimals)
                      : '0';
                  const isActiveRow = activeRowKey === row.key;
                  const isOtherRowBusy = writeInFlight && !isActiveRow;

                  return (
                    <TableRow key={row.key}>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-2">
                          <SentinelAllocationLabel
                            label={row.label}
                            morphoHref={row.morphoHref}
                            className="font-medium"
                          />
                          {row.lltv && (
                            <Badge variant="outline" className="text-xs">
                              {row.lltv}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatAllocationTableAmount(
                          row.currentRaw,
                          assetSymbol,
                          assetDecimals ?? chainDecimals
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs">
                        {row.absoluteCap
                          ? formatCapTokenAmount(row.absoluteCap, assetSymbol, assetDecimals)
                          : '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs">
                        {row.relativeCap ? formatCapRelative(row.relativeCap) : '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.supplyApy != null ? formatPercentage(row.supplyApy * 100, 2) : '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.liquidityUsd != null ? formatFullUSD(row.liquidityUsd, 2) : '—'}
                      </TableCell>
                      <TableCell>
                        {row.canDeallocate ? (
                          <div className="flex flex-col gap-1">
                          <div className="flex flex-wrap items-center gap-1">
                            <Input
                              type="text"
                              className="h-8 min-w-[100px] flex-1"
                              placeholder={amountPlaceholder}
                              value={amounts[row.key] ?? ''}
                              disabled={isOtherRowBusy}
                              onChange={(e) => setAmount(row.key, e.target.value)}
                            />
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="shrink-0 px-2"
                              disabled={isOtherRowBusy || minDeallocate <= 0n}
                              title="Min = withdrawable market liquidity (leaves illiquid remainder)"
                              onClick={() => setRowMinDeallocate(row)}
                            >
                              Min
                            </Button>
                            <TransactionButton
                              label="Deallocate"
                              size="sm"
                              suppressConnectPrompt
                              disabled={!amounts[row.key]?.trim() || isOtherRowBusy}
                              onClick={() => requestDeallocate(row)}
                              isLoading={isActiveRow && write.isLoading}
                              isSuccess={isActiveRow && write.isSuccess}
                              error={isActiveRow ? write.error : null}
                              txHash={isActiveRow ? write.txHash : undefined}
                            />
                          </div>
                          {rowErrors[row.key] && (
                            <p className="text-xs text-red-600 dark:text-red-400">{rowErrors[row.key]}</p>
                          )}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
      </CuratorTableShell>
      <TxPreviewDialog
        open={previewOpen}
        preview={txPreview}
        onOpenChange={(open) => {
          if (!open && ((writeInFlight && isBroadcastTxHash(write.txHash)) || queueingSafe)) {
            return;
          }
          setPreviewOpen(open);
          if (!open) {
            setTxPreview(null);
            pendingConfirmRef.current = null;
            pendingCalldataRef.current = null;
            setQueueSafeError(null);
            if (!isBroadcastTxHash(write.txHash)) write.reset();
          }
        }}
        destinationOptions={{
          destination: writeDestination,
          onDestinationChange: setWriteDestination,
          walletReady,
          walletHint: sentinelWalletHint,
          safeRoles: eligibleSentinelSafes,
          confirmEnabled: canConfirmVaultWriteDestination(writeDestination, {
            walletReady,
            eligibleSafeRoles: eligibleSentinelSafes,
          }),
        }}
        onConfirm={() => handlePreviewConfirm()}
        isLoading={writeDestination.kind === 'safe' ? queueingSafe : writeInFlight}
        error={
          writeDestination.kind === 'safe'
            ? queueSafeError
              ? new Error(queueSafeError)
              : null
            : write.error
        }
      />
    </div>
  );
}

function findCapByRowKey(
  rowKey: string,
  grouped: ReturnType<typeof groupCaps>
): CapInfo | null {
  for (let i = 0; i < grouped.adapter.length; i++) {
    if (capRowKey(grouped.adapter[i], i) === rowKey) return grouped.adapter[i];
  }
  for (let i = 0; i < grouped.collateral.length; i++) {
    if (capRowKey(grouped.collateral[i], i) === rowKey) return grouped.collateral[i];
  }
  for (let i = 0; i < grouped.market.length; i++) {
    if (capRowKey(grouped.market[i], i) === rowKey) return grouped.market[i];
  }
  return null;
}

function buildOverviewAndDeallocate(
  risk: V2VaultRiskResponse,
  governance: VaultV2GovernanceResponse | null | undefined,
  wrapperVaultAddress: string,
  chainId: number
): {
  totalRaw: bigint;
  overviewSegments: OverviewSegment[];
  deallocateRows: DeallocateRow[];
} {
  const capByMarket = new Map<string, CapInfo>();
  const capByAdapter = new Map<string, CapInfo>();
  for (const cap of governance?.caps ?? []) {
    if (cap.marketKey) capByMarket.set(cap.marketKey.toLowerCase(), cap);
    if (cap.adapterAddress && !cap.marketKey && !cap.collateralAddress) {
      capByAdapter.set(cap.adapterAddress.toLowerCase(), cap);
    }
  }

  const idleRaw = parseBig(risk.idleAssets);
  let totalRaw = idleRaw;
  const overviewSegments: OverviewSegment[] = [];
  const deallocateRows: DeallocateRow[] = [];

  overviewSegments.push({
    key: 'idle',
    label: 'Idle',
    morphoHref: null,
    pct: 0,
    raw: idleRaw,
    color: BAR_COLORS[0],
  });

  deallocateRows.push({
    key: 'idle',
    label: 'Idle',
    morphoHref: null,
    lltv: null,
    adapterAddress: '',
    idData: '0x',
    currentRaw: idleRaw,
    liquidityAssets: null,
    allocationPct: 0,
    supplyApy: null,
    liquidityUsd: null,
    absoluteCap: null,
    relativeCap: null,
    canDeallocate: false,
  });

  for (const adapter of risk.adapters ?? []) {
    if (isMorphoVaultV2Adapter(adapter)) {
      const booked =
        adapter.bookedAllocationAssets != null
          ? parseBig(adapter.bookedAllocationAssets)
          : null;
      const raw = booked ?? 0n;
      totalRaw += raw;
      const underlying = adapter.underlying;
      const label = adapter.adapterLabel || underlying?.name || underlying?.symbol || 'Underlying vault';
      const underlyingHref = curatorVaultHref(
        resolveUnderlyingVaultAddress(wrapperVaultAddress, underlying?.address)
      );
      const adapterCap = capByAdapter.get(adapter.adapterAddress.toLowerCase());
      overviewSegments.push({
        key: `underlying-${adapter.adapterAddress}`,
        label,
        morphoHref: underlyingHref,
        pct: 0,
        raw,
        color: BAR_COLORS[1] ?? BAR_COLORS[2],
      });
      deallocateRows.push({
        key: `underlying-${adapter.adapterAddress}`,
        label,
        morphoHref: underlyingHref,
        lltv: null,
        adapterAddress: adapter.adapterAddress,
        idData: EMPTY_ADAPTER_DATA,
        currentRaw: raw,
        liquidityAssets: (() => {
          const liq = underlying?.liquidity;
          if (liq == null) return null;
          try {
            return BigInt(String(liq));
          } catch {
            return null;
          }
        })(),
        allocationPct: 0,
        supplyApy: underlying?.avgNetApy ?? underlying?.netApy ?? null,
        liquidityUsd: underlying?.liquidityUsd ?? null,
        absoluteCap: adapterCap?.absoluteCap ?? null,
        relativeCap: adapterCap?.relativeCap ?? null,
        canDeallocate: booked != null && booked > 0n,
      });
      continue;
    }

    for (const m of adapter.markets ?? []) {
      const booked =
        m.bookedAllocationAssets != null ? parseBig(m.bookedAllocationAssets) : null;
      const raw = booked ?? 0n;
      totalRaw += raw;
      const key = marketKeyFromGraphQL(m.market);
      const cap = key ? capByMarket.get(key.toLowerCase()) : undefined;
      const col = m.market?.collateralAsset?.symbol;
      const loan = m.market?.loanAsset?.symbol;
      const label = formatMarketPairLabel(col, loan);
      const morphoHref = key
        ? curatorBlueMarketHref(key, chainId, `/vault/${wrapperVaultAddress}/sentinel`)
        : null;
      overviewSegments.push({
        key: key ?? `${adapter.adapterAddress}-${col}-${loan}`,
        label,
        morphoHref,
        pct: 0,
        raw,
        color: BAR_COLORS[2],
      });

      deallocateRows.push({
        key: key ?? `${adapter.adapterAddress}-${col}-${loan}`,
        label,
        morphoHref,
        lltv: formatLltvPill(m.market?.lltv ?? null),
        adapterAddress: adapter.adapterAddress,
        idData: m.market ? encodeMarketParamsData(m.market) : ('0x' as Hex),
        currentRaw: raw,
        liquidityAssets: (() => {
          const liq = m.market?.state?.liquidityAssets;
          if (liq == null) return null;
          try {
            return BigInt(String(liq));
          } catch {
            return null;
          }
        })(),
        allocationPct: 0,
        supplyApy: m.market?.state?.supplyApy ?? null,
        liquidityUsd: m.market?.state?.liquidityAssetsUsd ?? null,
        absoluteCap: cap?.absoluteCap ?? null,
        relativeCap: cap?.relativeCap ?? null,
        canDeallocate: booked != null && booked > 0n && Boolean(m.market),
      });
    }
  }

  const totalForPct = totalRaw > 0n ? totalRaw : 1n;
  for (const seg of overviewSegments) {
    seg.pct = Number((seg.raw * 10000n) / totalForPct) / 100;
  }
  for (const row of deallocateRows) {
    row.allocationPct = Number((row.currentRaw * 10000n) / totalForPct) / 100;
  }

  overviewSegments.sort((a, b) => Number(b.raw - a.raw));
  deallocateRows.sort((a, b) => {
    if (a.key === 'idle') return -1;
    if (b.key === 'idle') return 1;
    return Number(b.currentRaw - a.currentRaw);
  });

  return { totalRaw, overviewSegments, deallocateRows };
}

function parseBig(value: string | null | undefined): bigint {
  if (!value) return 0n;
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

