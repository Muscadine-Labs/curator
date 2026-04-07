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
import { useVaultWrite } from '@/lib/hooks/useVaultWrite';
import { TransactionButton } from '@/components/TransactionButton';
import { v2WriteConfigs } from '@/lib/onchain/vault-writes';
import type { Address, Hex } from 'viem';
import { parseUnits, encodeAbiParameters, parseAbiParameters } from 'viem';
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

type AdapterType = 'MetaMorphoAdapter' | 'MorphoMarketV1Adapter' | string;

/** One allocation target that can be individually allocated/deallocated. */
interface AllocTarget {
  label: string;
  adapterAddress: string;
  adapterType: AdapterType;
  /** ABI-encoded data param for allocate/deallocate. MetaMorpho=0x, Market=encoded market params */
  data: Hex;
  currentAssets: bigint;
  currentUsd: number;
  decimals: number;
  symbol: string;
  isMetaMorpho: boolean;
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
};

type RowType = TargetRow | DisplayRow;

export function VaultV2Allocations({ vaultAddress, preloadedRisk }: VaultV2AllocationsProps) {
  const { data: fetchedRisk, isLoading, error } = useVaultV2Risk(vaultAddress);
  const risk = preloadedRisk ?? fetchedRisk;

  const { rows, totalUsd, targets, totalRawAssets, vaultDecimals, vaultSymbol } = useMemo(() => {
    if (!risk?.adapters) return { rows: [] as RowType[], totalUsd: 0, targets: [] as AllocTarget[], totalRawAssets: BigInt(0), vaultDecimals: 18, vaultSymbol: '' };

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
        // MetaMorphoAdapter: one target per adapter, data=0x
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

        targets.push({
          label: adapter.adapterLabel || 'MetaMorpho',
          adapterAddress: adapter.adapterAddress,
          adapterType: adapter.adapterType,
          data: '0x' as Hex,
          currentAssets: rawAssets,
          currentUsd: adapter.allocationUsd ?? 0,
          decimals: allocDec,
          symbol: allocSym,
          isMetaMorpho: true,
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
        });

        // Sub-market display rows
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
        // MorphoMarketV1Adapter: one target PER MARKET
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

          const tIdx = targets.length;
          targets.push({
            label,
            adapterAddress: adapter.adapterAddress,
            adapterType: adapter.adapterType,
            data,
            currentAssets: rawAssets,
            currentUsd: m.allocationUsd ?? 0,
            decimals: allocDec,
            symbol: allocSym,
            isMetaMorpho: false,
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
          });
        }
      }
    }

    return { rows, totalUsd, targets, totalRawAssets: totalRaw, vaultDecimals: dec, vaultSymbol: sym };
  }, [risk]);

  const [editing, setEditing] = useState(false);
  const [inputMode, setInputMode] = useState<InputMode>('percentage');
  const [inputValues, setInputValues] = useState<string[]>([]);
  const multicallWrite = useVaultWrite();

  const startEditing = useCallback(() => {
    setInputValues(targets.map(() => ''));
    setEditing(true);
  }, [targets]);

  const cancelEditing = useCallback(() => {
    setEditing(false);
    multicallWrite.reset();
  }, [multicallWrite]);

  const updateInput = useCallback((idx: number, val: string) => {
    setInputValues((prev) => prev.map((v, i) => i === idx ? val : v));
  }, []);

  const resolvedAllocations = useMemo(() => {
    if (!editing || inputValues.length === 0 || inputValues.length !== targets.length) return null;

    const modified = inputValues.filter((v) => v.trim() !== '');
    if (modified.length === 0) return null;

    const results: { target: AllocTarget; assets: bigint; current: bigint }[] = [];
    let errorMsg: string | null = null;

    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
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

    if (errorMsg) return { valid: false as const, error: errorMsg, results: [] };
    if (results.length !== targets.length) return { valid: false as const, error: 'Missing entries', results: [] };

    // Dust adjustment: push remainder onto the largest allocation
    let sum = results.reduce((s, r) => s + r.assets, BigInt(0));
    const diff = totalRawAssets - sum;
    if (diff !== BigInt(0)) {
      const largest = results.reduce((best, r) => r.assets > best.assets ? r : best, results[0]);
      largest.assets += diff;
      sum = totalRawAssets;
    }

    if (results.some((r) => r.assets < BigInt(0))) {
      return { valid: false as const, error: 'Allocation would go negative after dust adjustment', results: [] };
    }

    const anyChanged = results.some((r) => r.assets !== r.current);
    if (!anyChanged) return { valid: false as const, error: null, results: [] };

    return { valid: true as const, error: null, results };
  }, [editing, inputValues, targets, inputMode, totalRawAssets]);

  const handleRebalance = useCallback(() => {
    if (!resolvedAllocations?.valid) return;

    // Build multicall: deallocations first (to free idle), then allocations
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
      // Single operation: no need for multicall wrapper
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

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div>
            <CardTitle>Allocations</CardTitle>
            <CardDescription>
              Total: {formatCompactUSD(totalUsd)} ({formatTokenAmount(totalRawAssets, vaultDecimals, 2)} {vaultSymbol})
            </CardDescription>
          </div>
          {!editing ? (
            <Button variant="outline" size="sm" onClick={startEditing} className="flex items-center gap-1.5">
              <Pencil className="h-3.5 w-3.5" /> Rebalance
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <div className="flex gap-0.5 rounded-md border p-0.5">
                <button
                  onClick={() => { setInputMode('percentage'); setInputValues(targets.map(() => '')); }}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${inputMode === 'percentage' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                >%</button>
                <button
                  onClick={() => { setInputMode('tokens'); setInputValues(targets.map(() => '')); }}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${inputMode === 'tokens' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                >{vaultSymbol || 'Tokens'}</button>
              </div>
              <Button variant="ghost" size="sm" onClick={cancelEditing}>Cancel</Button>
            </div>
          )}
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
                <TableHead className="text-right">%</TableHead>
                {editing && <TableHead className="text-right w-40">New Allocation</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => {
                if (r.kind === 'target') {
                  const t = targets[r.targetIdx];
                  const currentPct = totalRawAssets > BigInt(0) ? Number(t.currentAssets * BigInt(10000) / totalRawAssets) / 100 : 0;

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
                              ? `${formatTokenAmount(BigInt(r.allocAssets), r.allocDecimals, 2)} ${r.allocSymbol ?? ''}`.trim()
                              : '—'}
                          </span>
                          <span className="text-muted-foreground text-xs">{formatCompactUSD(r.allocated)}</span>
                        </div>
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

                // Display row (sub-market under MetaMorpho)
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
                            ? `${formatTokenAmount(BigInt(r.allocAssets), r.allocDecimals, 2)} ${r.allocSymbol ?? ''}`.trim()
                            : '—'}
                        </span>
                        <span className="text-muted-foreground text-xs">{formatCompactUSD(r.allocated)}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">{`${r.pct.toFixed(2)}%`}</TableCell>
                    {editing && <TableCell />}
                  </TableRow>
                );
              })}
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
                  Balanced (dust auto-adjusted). Ready to submit.
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
