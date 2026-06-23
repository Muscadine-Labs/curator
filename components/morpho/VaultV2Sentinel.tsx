'use client';

import { useCallback, useMemo, useState } from 'react';
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
import { formatLltvPill, formatMarketPairLabel } from '@/components/morpho/AllocationListView';
import { VaultV2Pending } from '@/components/morpho/VaultV2Pending';
import { useVaultV2Governance } from '@/lib/hooks/useVaultV2Governance';
import { useVaultV2Risk } from '@/lib/hooks/useVaultV2Risk';
import { useVaultWrite } from '@/lib/hooks/useVaultWrite';
import { v2WriteConfigs } from '@/lib/onchain/vault-writes';
import {
  buildAdapterLabelMap,
  capDisplayLabel,
  capRowKey,
  formatCapRelative,
  formatCapTokenAmount,
  groupCaps,
} from '@/lib/morpho/v2-cap-format';
import {
  METAMORPHO_ADAPTER_DATA,
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
import { marketKeyFromGraphQL } from '@/lib/morpho/morpho-app-links';
import { VAULT_VERSION_MAP } from '@/lib/morpho/treasury-statement';
import { vaultV2Abi } from '@/lib/onchain/abis';
import type { CapInfo, VaultV2GovernanceResponse } from '@/app/api/vaults/v2/[id]/governance/route';
import type { V2VaultRiskResponse } from '@/app/api/vaults/v2/[id]/risk/route';
import type { VaultV2PendingResponse } from '@/app/api/vaults/v2/[id]/pending/route';
import type { Address, Hex } from 'viem';
import { encodeFunctionData } from 'viem';

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
  lltv: string | null;
  wrappedVaultVersion: 'v1' | 'v2' | null;
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
  const { data: fetchedRisk, isLoading: riskLoading } = useVaultV2Risk(vaultAddress);
  const governance = preloadedGovernance ?? fetchedGov;
  const risk = preloadedRisk ?? fetchedRisk;

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
                  <span className="truncate text-slate-800 dark:text-slate-200">{seg.label}</span>
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
        assetSymbol={assetSymbol}
        assetDecimals={assetDecimals}
        chainDecimals={chainDecimals}
      />

      <DeallocatePanel
        rows={deallocateRows}
        vaultAddress={vaultAddress}
        assetSymbol={assetSymbol}
        assetDecimals={assetDecimals}
        chainDecimals={chainDecimals}
        displayDecimals={displayDecimals}
      />
    </div>
  );
}

function DecreaseCapsPanel({
  grouped,
  risk,
  adapterLabels,
  vaultAddress,
  assetSymbol,
  assetDecimals,
  chainDecimals,
}: {
  grouped: ReturnType<typeof groupCaps>;
  risk: V2VaultRiskResponse;
  adapterLabels: Map<string, string>;
  vaultAddress: string;
  assetSymbol?: string | null;
  assetDecimals?: number | null;
  chainDecimals: number;
}) {
  const [selections, setSelections] = useState<Record<string, CapDecreaseMode>>({});
  const [newValues, setNewValues] = useState<Record<string, string>>({});
  const write = useVaultWrite();

  const setSelection = (rowKey: string, mode: CapDecreaseMode) => {
    setSelections((prev) => ({ ...prev, [rowKey]: mode }));
  };

  const submitRowDecrease = useCallback(
    (rowKey: string, mode: CapDecreaseMode, valueStr: string) => {
      const cap = findCapByRowKey(rowKey, grouped);
      if (!cap) return;
      const idData = resolveCapIdData(cap, risk);
      if (!idData) return;

      if (mode === 'absolute') {
        const parsed = parseHumanTokenInput(valueStr, assetSymbol, chainDecimals);
        const current = BigInt(cap.absoluteCap);
        if (parsed > current) return;
        write.write(
          v2WriteConfigs.decreaseAbsoluteCap(vaultAddress as Address, idData, parsed)
        );
        return;
      }

      const pct = Number(valueStr);
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) return;
      const wad = BigInt(Math.round(pct * 1e16));
      const current = BigInt(cap.relativeCap);
      if (wad > current) return;
      write.write(
        v2WriteConfigs.decreaseRelativeCap(vaultAddress as Address, idData, wad)
      );
    },
    [assetSymbol, chainDecimals, grouped, risk, vaultAddress, write]
  );

  const clearCap = useCallback(
    (rowKey: string) => {
      const cap = findCapByRowKey(rowKey, grouped);
      if (!cap) return;
      const idData = resolveCapIdData(cap, risk);
      if (!idData) return;

      const calls: Hex[] = [
        encodeFunctionData({
          abi: vaultV2Abi,
          functionName: 'decreaseAbsoluteCap',
          args: [idData, 0n],
        }),
        encodeFunctionData({
          abi: vaultV2Abi,
          functionName: 'decreaseRelativeCap',
          args: [idData, 0n],
        }),
      ];
      write.write(v2WriteConfigs.multicall(vaultAddress as Address, calls));
    },
    [grouped, risk, vaultAddress, write]
  );

  const setClearValue = (rowKey: string, mode: CapDecreaseMode) => {
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
          Pick absolute or relative cap, enter a new value (must be ≤ current), then Decrease. Clear
          sets both caps to 0 (disables new allocations to that target).
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
                          section.showLltv && cap.marketKey
                            ? resolveLltv(cap.marketKey, risk)
                            : null;
                        const idData = resolveCapIdData(cap, risk);
                        const mode = selections[rowKey] ?? null;

                        return (
                          <TableRow key={rowKey}>
                            <TableCell>
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-medium">{label}</span>
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
                              <div className="flex flex-wrap items-center gap-2">
                                <Input
                                  type="text"
                                  className="h-8 min-w-[90px] flex-1"
                                  placeholder={mode === 'relative' ? '0–100' : 'New cap'}
                                  value={newValues[rowKey] ?? ''}
                                  disabled={!mode || !idData}
                                  onChange={(e) =>
                                    setNewValues((prev) => ({ ...prev, [rowKey]: e.target.value }))
                                  }
                                />
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  disabled={!idData}
                                  onClick={() => setClearValue(rowKey, mode ?? 'absolute')}
                                >
                                  0
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  disabled={!idData}
                                  onClick={() => clearCap(rowKey)}
                                >
                                  Clear
                                </Button>
                                <TransactionButton
                                  label="Decrease"
                                  size="sm"
                                  suppressConnectPrompt
                                  disabled={!idData || !mode || !(newValues[rowKey]?.trim())}
                                  onClick={() =>
                                    mode &&
                                    submitRowDecrease(rowKey, mode, newValues[rowKey] ?? '')
                                  }
                                  isLoading={write.isLoading}
                                  isSuccess={write.isSuccess}
                                  error={write.error}
                                  txHash={write.txHash}
                                />
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
    </Card>
  );
}

function DeallocatePanel({
  rows,
  vaultAddress,
  assetSymbol,
  assetDecimals,
  chainDecimals,
  displayDecimals,
}: {
  rows: DeallocateRow[];
  vaultAddress: string;
  assetSymbol?: string | null;
  assetDecimals?: number | null;
  chainDecimals: number;
  displayDecimals: number;
}) {
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const write = useVaultWrite();

  const setAmount = (key: string, value: string) => {
    setAmounts((prev) => ({ ...prev, [key]: value }));
  };

  const zeroOutRow = (row: DeallocateRow) => {
    if (!row.canDeallocate || row.currentRaw === 0n) return;
    setAmount(
      row.key,
      formatAllocationEditInputExact(row.currentRaw, assetSymbol, assetDecimals ?? chainDecimals)
    );
  };

  const deallocateRow = useCallback(
    (row: DeallocateRow) => {
      if (!row.canDeallocate || row.currentRaw === 0n) return;
      const rawInput = amounts[row.key]?.trim();
      if (!rawInput) return;
      let parsed: bigint;
      try {
        parsed = parseHumanTokenInput(rawInput, assetSymbol, chainDecimals);
      } catch {
        return;
      }
      parsed = clampDeallocateAmount(parsed, row.currentRaw);
      if (parsed <= 0n) return;
      write.write(
        v2WriteConfigs.deallocate(
          vaultAddress as Address,
          row.adapterAddress as Address,
          row.idData,
          parsed
        )
      );
    },
    [amounts, assetSymbol, chainDecimals, vaultAddress, write]
  );

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
                  return (
                    <TableRow key={row.key}>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{row.label}</span>
                          {row.wrappedVaultVersion && (
                            <Badge variant="outline" className="text-xs uppercase">
                              {row.wrappedVaultVersion}
                            </Badge>
                          )}
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
                          <div className="flex flex-wrap items-center gap-1">
                            <Input
                              type="text"
                              className="h-8 min-w-[100px] flex-1"
                              placeholder={maxLabel}
                              value={amounts[row.key] ?? ''}
                              onChange={(e) => setAmount(row.key, e.target.value)}
                            />
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="shrink-0 px-2"
                              onClick={() => zeroOutRow(row)}
                            >
                              Zero out
                            </Button>
                            <TransactionButton
                              label="Deallocate"
                              size="sm"
                              suppressConnectPrompt
                              disabled={!amounts[row.key]?.trim()}
                              onClick={() => deallocateRow(row)}
                              isLoading={write.isLoading}
                              isSuccess={write.isSuccess}
                              error={write.error}
                              txHash={write.txHash}
                            />
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
        {write.error && (
          <p className="mt-3 text-sm text-red-600 dark:text-red-400">
            {write.error.message}
          </p>
        )}
      </CardContent>
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

function resolveLltv(marketKey: string, risk: V2VaultRiskResponse): string | null {
  const needle = marketKey.toLowerCase();
  for (const adapter of risk.adapters ?? []) {
    for (const m of adapter.markets ?? []) {
      const key = marketKeyFromGraphQL(m.market);
      if (key?.toLowerCase() === needle) {
        return formatLltvPill(m.market?.lltv ?? null);
      }
    }
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

  let idleRaw = parseBig(risk.idleAssets);
  let totalRaw = idleRaw;
  const overviewSegments: OverviewSegment[] = [];
  const deallocateRows: DeallocateRow[] = [];

  if (idleRaw > 0n || (risk.idleAssetsUsd ?? 0) > 0) {
    overviewSegments.push({
      key: 'idle',
      label: 'Idle',
      pct: 0,
      raw: idleRaw,
      color: BAR_COLORS[0],
    });
  }

  deallocateRows.push({
    key: 'idle',
    label: 'Idle',
    lltv: null,
    wrappedVaultVersion: null,
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
    if (adapter.adapterType === 'MetaMorphoAdapter') {
      const raw = parseBig(adapter.allocationAssets);
      totalRaw += raw;
      const cap = capByAdapter.get(adapter.adapterAddress.toLowerCase());
      const underlyingAddr = adapter.underlyingVaultAddress?.toLowerCase();
      const wrappedVersion = underlyingAddr ? VAULT_VERSION_MAP[underlyingAddr] ?? 'v1' : 'v1';

      overviewSegments.push({
        key: `meta-${adapter.adapterAddress}`,
        label: adapter.adapterLabel || 'MetaMorpho',
        pct: 0,
        raw,
        color: BAR_COLORS[1],
      });

      deallocateRows.push({
        key: `meta-${adapter.adapterAddress}`,
        label: adapter.adapterLabel || 'MetaMorpho',
        lltv: null,
        wrappedVaultVersion: wrappedVersion,
        adapterAddress: adapter.adapterAddress,
        idData: METAMORPHO_ADAPTER_DATA,
        currentRaw: raw,
        allocationPct: 0,
        supplyApy: adapter.underlyingVaultStats?.netApy ?? null,
        liquidityUsd: adapter.underlyingVaultStats?.liquidityUsd ?? null,
        absoluteCap: cap?.absoluteCap ?? null,
        relativeCap: cap?.relativeCap ?? null,
        canDeallocate: raw > 0n,
      });
      continue;
    }

    for (const m of adapter.markets ?? []) {
      const raw = parseBig(m.allocationAssets);
      totalRaw += raw;
      const key = marketKeyFromGraphQL(m.market);
      const cap = key ? capByMarket.get(key.toLowerCase()) : undefined;
      const col = m.market?.collateralAsset?.symbol;
      const loan = m.market?.loanAsset?.symbol;
      const label = formatMarketPairLabel(col, loan);
      overviewSegments.push({
        key: key ?? `${adapter.adapterAddress}-${col}-${loan}`,
        label,
        pct: 0,
        raw,
        color: BAR_COLORS[2],
      });

      deallocateRows.push({
        key: key ?? `${adapter.adapterAddress}-${col}-${loan}`,
        label,
        lltv: formatLltvPill(m.market?.lltv ?? null),
        wrappedVaultVersion: null,
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

