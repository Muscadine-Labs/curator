'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useAccount } from 'wagmi';
import { Info } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
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
import { v2WriteConfigs } from '@/lib/onchain/vault-writes';
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
import { marketKeyFromGraphQL, morphoMarketHref } from '@/lib/morpho/morpho-app-links';
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
import { queueVaultWriteInSafe } from '@/lib/safe/queue-vault-write';
import { useCuratorSafeApps } from '@/lib/safe/safe-apps-context';
import { SENTINEL_SAFE_ROLE } from '@/lib/safe/config';
import { resolveSentinelWriteMode } from '@/lib/safe/vault-role-match';
import { vaultWriteToCalldata } from '@/lib/safe/encode-vault-write';

interface VaultV2SentinelProps {
  vaultAddress: string;
  chainId: number;
  preloadedGovernance?: VaultV2GovernanceResponse | null;
  preloadedRisk?: V2VaultRiskResponse | null;
  preloadedPending?: VaultV2PendingResponse | null;
  assetSymbol?: string | null;
  assetDecimals?: number | null;
}

type DeallocateRow = {
  key: string;
  label: string;
  morphoHref: string | null;
  lltv: string | null;
  adapterAddress: string;
  idData: Hex;
  currentRaw: bigint;
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
      <span className={className ?? 'truncate text-slate-800 dark:text-slate-200'}>{label}</span>
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
}: VaultV2SentinelProps) {
  const { data: fetchedGov, isLoading: govLoading } = useVaultV2Governance(vaultAddress);
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
    return buildOverviewAndDeallocate(risk, governance);
  }, [risk, governance]);

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
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-slate-500 dark:text-slate-400">Total Assets</p>
            <p className="text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
              {formatAllocationTableAmount(totalRaw, assetSymbol, assetDecimals ?? chainDecimals)}
            </p>
          </div>
          <div className="mt-3 flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
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
          <div className="mt-4 space-y-2">
            {overviewSegments.map((seg, i) => (
              <div key={seg.key} className="flex items-center justify-between gap-3 text-sm">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${BAR_COLORS[i % BAR_COLORS.length]}`}
                  />
                  <SentinelAllocationLabel label={seg.label} morphoHref={seg.morphoHref} />
                </div>
                <div className="flex shrink-0 items-center gap-4 tabular-nums text-slate-600 dark:text-slate-300">
                  <span>
                    {formatAllocationTableAmount(seg.raw, assetSymbol, assetDecimals ?? chainDecimals)}
                  </span>
                  <span className="w-14 text-right">{seg.pct.toFixed(1)}%</span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Vault Pending Actions</CardTitle>
          <CardDescription>
            Pending timelock actions on this vault that can be revoked.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <VaultV2Pending
            vaultAddress={vaultAddress}
            chainId={chainId}
            preloadedData={preloadedPending}
            embedded
            sentinelEmpty
            allowRevoke
          />
        </CardContent>
      </Card>

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
  const pendingConfirmRef = useRef<(() => Promise<void>) | null>(null);
  const pendingCalldataRef = useRef<{ to: Address; data: Hex } | null>(null);
  const queryClient = useQueryClient();
  const router = useRouter();
  const { address: walletAddress } = useAccount();
  const { connected: safeAppConnected, sdk: safeAppSdk, safeRole: safeAppRole } =
    useCuratorSafeApps();
  const sentinelSafeAppSdk = useMemo(
    () =>
      safeAppConnected && safeAppSdk && safeAppRole === 'sentinel' ? safeAppSdk : null,
    [safeAppConnected, safeAppSdk, safeAppRole]
  );
  const sentinelWriteMode = useMemo(
    () => resolveSentinelWriteMode(sentinels, walletAddress),
    [sentinels, walletAddress]
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
      setPreviewOpen(true);
    },
    [adapterLabels, assetDecimals, assetSymbol, chainDecimals, grouped, risk, submitRowDecrease, vaultAddress]
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

  const handleQueueInSentinelSafe = useCallback(async () => {
    if (!txPreview || !pendingCalldataRef.current) return;

    setQueueingSafe(true);
    setQueueSafeError(null);

    try {
      await queueVaultWriteInSafe({
        safeRole: SENTINEL_SAFE_ROLE,
        calldata: pendingCalldataRef.current,
        description: `Sentinel cap decrease — ${assetSymbol ?? vaultAddress}`,
        preview: txPreview,
        source: {
          type: 'sentinel',
          action: 'decrease_cap',
          vaultAddress: getAddress(vaultAddress),
          vaultSymbol: assetSymbol ?? undefined,
        },
        proposer: walletAddress ? getAddress(walletAddress) : undefined,
        safeAppSdk: sentinelSafeAppSdk,
      });
      setPreviewOpen(false);
      setTxPreview(null);
      pendingConfirmRef.current = null;
      pendingCalldataRef.current = null;
      router.push('/safe/sentinel');
    } catch (error) {
      setQueueSafeError(
        error instanceof Error ? error.message : 'Failed to queue Safe transaction.'
      );
    } finally {
      setQueueingSafe(false);
    }
  }, [assetSymbol, router, sentinelSafeAppSdk, txPreview, vaultAddress, walletAddress]);

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
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Decrease Caps
          <Info className="h-4 w-4 text-slate-400" aria-hidden />
        </CardTitle>
        <CardDescription className="mt-1">
          Pick absolute or relative cap, enter a new value (must be ≤ current), then Decrease. Use 0
          to preset zero; Clear resets the row input.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-8">
        {totalCaps === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">No caps configured.</p>
        ) : (
          sections.map((section) =>
            section.caps.length === 0 ? null : (
              <div key={section.title} className="space-y-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {section.title}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{section.description}</p>
                </div>
                <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-800">
                  <Table>
                    <TableHeader>
                      <TableRow>
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
                </div>
              </div>
            )
          )
        )}
      </CardContent>
      <TxPreviewDialog
        open={previewOpen}
        preview={txPreview}
        onOpenChange={(open) => {
          if (writeInFlight || queueingSafe) return;
          setPreviewOpen(open);
          if (!open) {
            setTxPreview(null);
            pendingConfirmRef.current = null;
            pendingCalldataRef.current = null;
            setQueueSafeError(null);
          }
        }}
        writeMode={sentinelWriteMode}
        onConfirm={
          sentinelWriteMode === 'safe'
            ? () => void handleQueueInSentinelSafe()
            : confirmPreview
        }
        isLoading={sentinelWriteMode === 'safe' ? queueingSafe : writeInFlight}
        error={
          sentinelWriteMode === 'safe'
            ? queueSafeError
              ? new Error(queueSafeError)
              : null
            : write.error
        }
        confirmLabel={
          sentinelWriteMode === 'safe' ? 'Queue in Sentinel Safe' : 'Confirm decrease'
        }
        secondaryLabel={
          sentinelWriteMode === 'both' ? 'Queue in Sentinel Safe' : undefined
        }
        onSecondary={
          sentinelWriteMode === 'both'
            ? () => void handleQueueInSentinelSafe()
            : undefined
        }
        secondaryLoading={queueingSafe}
        secondaryError={queueSafeError ? new Error(queueSafeError) : null}
      />
    </Card>
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
  const pendingConfirmRef = useRef<(() => Promise<void>) | null>(null);
  const pendingCalldataRef = useRef<{ to: Address; data: Hex } | null>(null);
  const queryClient = useQueryClient();
  const router = useRouter();
  const { address: walletAddress } = useAccount();
  const { connected: safeAppConnected, sdk: safeAppSdk, safeRole: safeAppRole } =
    useCuratorSafeApps();
  const sentinelSafeAppSdk = useMemo(
    () =>
      safeAppConnected && safeAppSdk && safeAppRole === 'sentinel' ? safeAppSdk : null,
    [safeAppConnected, safeAppSdk, safeAppRole]
  );
  const sentinelWriteMode = useMemo(
    () => resolveSentinelWriteMode(sentinels, walletAddress),
    [sentinels, walletAddress]
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

  const zeroOutRow = (row: DeallocateRow) => {
    if (!row.canDeallocate || row.currentRaw === 0n) return;
    setAmount(
      row.key,
      formatAllocationEditInputExact(row.currentRaw, assetSymbol, assetDecimals ?? chainDecimals)
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
      if (parsed <= 0n) {
        setRowErrors((prev) => ({
          ...prev,
          [row.key]: 'Amount must be greater than zero.',
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
      setPreviewOpen(true);
    },
    [amounts, assetDecimals, assetSymbol, chainDecimals, deallocateRow, vaultAddress]
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

  const handleQueueInSentinelSafe = useCallback(async () => {
    if (!txPreview || !pendingCalldataRef.current) return;

    setQueueingSafe(true);
    setQueueSafeError(null);

    try {
      await queueVaultWriteInSafe({
        safeRole: SENTINEL_SAFE_ROLE,
        calldata: pendingCalldataRef.current,
        description: `Sentinel deallocate — ${assetSymbol ?? vaultAddress}`,
        preview: txPreview,
        source: {
          type: 'sentinel',
          action: 'deallocate',
          vaultAddress: getAddress(vaultAddress),
          vaultSymbol: assetSymbol ?? undefined,
        },
        proposer: walletAddress ? getAddress(walletAddress) : undefined,
        safeAppSdk: sentinelSafeAppSdk,
      });
      setPreviewOpen(false);
      setTxPreview(null);
      pendingConfirmRef.current = null;
      pendingCalldataRef.current = null;
      router.push('/safe/sentinel');
    } catch (error) {
      setQueueSafeError(
        error instanceof Error ? error.message : 'Failed to queue Safe transaction.'
      );
    } finally {
      setQueueingSafe(false);
    }
  }, [assetSymbol, router, sentinelSafeAppSdk, txPreview, vaultAddress, walletAddress]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Deallocate to Idle</CardTitle>
        <CardDescription>
          Enter an amount and Deallocate, or Zero out to move the full position to idle cash.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-800">
          <Table>
            <TableHeader>
              <TableRow>
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
                  <TableCell colSpan={7} className="text-center text-slate-500">
                    No positions.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => {
                  const maxLabel = formatRawTokenAmount(
                    row.currentRaw,
                    chainDecimals,
                    displayDecimals
                  );
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
                              placeholder={maxLabel}
                              value={amounts[row.key] ?? ''}
                              disabled={isOtherRowBusy}
                              onChange={(e) => setAmount(row.key, e.target.value)}
                            />
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="shrink-0 px-2"
                              disabled={isOtherRowBusy}
                              onClick={() => zeroOutRow(row)}
                            >
                              Zero out
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
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
      <TxPreviewDialog
        open={previewOpen}
        preview={txPreview}
        onOpenChange={(open) => {
          if (writeInFlight || queueingSafe) return;
          setPreviewOpen(open);
          if (!open) {
            setTxPreview(null);
            pendingConfirmRef.current = null;
            pendingCalldataRef.current = null;
            setQueueSafeError(null);
          }
        }}
        writeMode={sentinelWriteMode}
        onConfirm={
          sentinelWriteMode === 'safe'
            ? () => void handleQueueInSentinelSafe()
            : confirmPreview
        }
        isLoading={sentinelWriteMode === 'safe' ? queueingSafe : writeInFlight}
        error={
          sentinelWriteMode === 'safe'
            ? queueSafeError
              ? new Error(queueSafeError)
              : null
            : write.error
        }
        confirmLabel={
          sentinelWriteMode === 'safe' ? 'Queue in Sentinel Safe' : 'Confirm deallocate'
        }
        secondaryLabel={
          sentinelWriteMode === 'both' ? 'Queue in Sentinel Safe' : undefined
        }
        onSecondary={
          sentinelWriteMode === 'both'
            ? () => void handleQueueInSentinelSafe()
            : undefined
        }
        secondaryLoading={queueingSafe}
        secondaryError={queueSafeError ? new Error(queueSafeError) : null}
      />
    </Card>
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
  governance: VaultV2GovernanceResponse | null | undefined
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

  if (idleRaw > 0n || (risk.idleAssetsUsd ?? 0) > 0) {
    overviewSegments.push({
      key: 'idle',
      label: 'Idle',
      morphoHref: null,
      pct: 0,
      raw: idleRaw,
      color: BAR_COLORS[0],
    });
  }

  deallocateRows.push({
    key: 'idle',
    label: 'Idle',
    morphoHref: null,
    lltv: null,
    adapterAddress: '',
    idData: '0x',
    currentRaw: idleRaw,
    allocationPct: 0,
    supplyApy: null,
    liquidityUsd: null,
    absoluteCap: null,
    relativeCap: null,
    canDeallocate: false,
  });

  for (const adapter of risk.adapters ?? []) {
    for (const m of adapter.markets ?? []) {
      const raw = parseBig(m.allocationAssets);
      totalRaw += raw;
      const key = marketKeyFromGraphQL(m.market);
      const cap = key ? capByMarket.get(key.toLowerCase()) : undefined;
      const col = m.market?.collateralAsset?.symbol;
      const loan = m.market?.loanAsset?.symbol;
      const label = formatMarketPairLabel(col, loan);
      const morphoHref = key ? morphoMarketHref(key) : null;
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
        allocationPct: 0,
        supplyApy: m.market?.state?.supplyApy ?? null,
        liquidityUsd: m.market?.state?.liquidityAssetsUsd ?? null,
        absoluteCap: cap?.absoluteCap ?? null,
        relativeCap: cap?.relativeCap ?? null,
        canDeallocate: raw > 0n,
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

