'use client';

import { useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PaginationBar } from '@/components/ui/pagination-bar';
import { CuratorPanel } from '@/components/morpho/CuratorChrome';
import { formatMarketTokenAmount } from '@/components/morpho/TokenUsdValue';
import { formatCompactUSD, formatPercentage } from '@/lib/format/number';
import { ExplorerAddressLink, ExplorerTxLink } from '@/components/morpho/ExplorerAddressLink';
import { getVaultByAddress } from '@/lib/config/vaults';
import {
  borrowToTargetUsd,
  healthTone,
  shareOf,
  type HealthTone,
} from '@/lib/morpho/market-activity-math';
import type { MarketActivity } from '@/lib/morpho/market-activity.server';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 10;
const BORROW_COLOR = '#3b82f6';
const SUPPLY_COLOR = '#10b981';
const TARGET_COLOR = '#a855f7';

type TokenMeta = { symbol: string; decimals: number };

function usePage<T>(rows: ReadonlyArray<T>) {
  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  return {
    page: safePage,
    totalPages,
    setPage,
    rows: rows.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE),
  };
}

function Amount({
  raw,
  usd,
  token,
}: {
  raw: string | null;
  usd: number | null;
  token: TokenMeta;
}) {
  return (
    <div className="flex flex-col items-end">
      <span className="tabular-nums">
        {formatMarketTokenAmount(raw, token.symbol, token.decimals) ?? '—'}
      </span>
      {usd != null && (
        <span className="text-xs tabular-nums text-muted-foreground">{formatCompactUSD(usd)}</span>
      )}
    </div>
  );
}

const HEALTH_CLASS: Record<HealthTone, string> = {
  liquidatable: 'text-red-600 dark:text-red-400 font-semibold',
  danger: 'text-red-600 dark:text-red-400',
  warning: 'text-amber-600 dark:text-amber-400',
  healthy: 'text-emerald-600 dark:text-emerald-400',
  unknown: 'text-muted-foreground',
};

function Table({
  head,
  children,
}: {
  head: ReadonlyArray<{ label: string; right?: boolean }>;
  children: ReactNode;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/40">
          <tr>
            {head.map((h) => (
              <th
                key={h.label}
                className={cn(
                  'whitespace-nowrap px-3 py-2 text-xs font-medium text-muted-foreground',
                  h.right ? 'text-right' : 'text-left'
                )}
              >
                {h.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

const td = 'whitespace-nowrap border-t border-border/60 px-3 py-2 align-middle';

function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-muted-foreground">{children}</p>;
}

function dateLabel(unix: number): string {
  return new Date(unix * 1000).toISOString().slice(5, 10);
}

/* ------------------------------------------------------------------ Rates */

type RateMode = 'borrow' | 'supply';

export function MarketRatesPanel({
  activity,
  borrowApy,
  supplyApy,
  utilization,
  supplyUsd,
  borrowUsd,
  targetUtilization,
  irmAddress,
  chainId,
}: {
  activity: MarketActivity;
  borrowApy: number | null;
  supplyApy: number | null;
  utilization: number | null;
  supplyUsd: number | null;
  borrowUsd: number | null;
  targetUtilization: number | null;
  irmAddress: string | null;
  chainId: number;
}) {
  const [mode, setMode] = useState<RateMode>('borrow');
  const target = targetUtilization ?? 0.9;
  const toTarget = borrowToTargetUsd(supplyUsd, borrowUsd, target);

  const rateSeries = useMemo(() => {
    const src = mode === 'borrow' ? activity.history.borrowApy : activity.history.supplyApy;
    const atTarget = new Map(activity.history.apyAtTarget.map((p) => [p.x, p.y]));
    return src.map((p) => ({
      x: p.x,
      rate: p.y * 100,
      target: mode === 'borrow' && atTarget.has(p.x) ? atTarget.get(p.x)! * 100 : undefined,
    }));
  }, [activity.history, mode]);

  const avg = (days: number) => {
    const src = mode === 'borrow' ? activity.history.borrowApy : activity.history.supplyApy;
    const since = Date.now() / 1000 - days * 86400;
    const pts = src.filter((p) => p.x >= since);
    if (pts.length === 0) return null;
    return (pts.reduce((s, p) => s + p.y, 0) / pts.length) * 100;
  };

  const curve = activity.irmCurve.map((p) => ({
    u: p.utilization * 100,
    borrow: p.borrowApy * 100,
    supply: p.supplyApy * 100,
  }));

  const current = mode === 'borrow' ? borrowApy : supplyApy;

  return (
    <CuratorPanel
      title="Rates"
      actions={
        <div className="flex gap-1">
          {(['borrow', 'supply'] as const).map((m) => (
            <Button
              key={m}
              size="sm"
              variant={mode === m ? 'secondary' : 'ghost'}
              onClick={() => setMode(m)}
              className="h-7 capitalize"
            >
              {m}
            </Button>
          ))}
        </div>
      }
    >
      <div className="grid gap-4 p-4 lg:grid-cols-[1fr_240px]">
        <div>
          <p className="text-xs text-muted-foreground">
            {mode === 'borrow' ? 'Borrow' : 'Supply'} APY · daily, 90 days
          </p>
          <p className="text-2xl font-semibold tabular-nums">
            {current != null ? formatPercentage(current * 100) : '—'}
          </p>
          {rateSeries.length === 0 ? (
            <Empty>No rate history yet</Empty>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={rateSeries} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="x"
                  tickFormatter={dateLabel}
                  tick={{ fontSize: 10 }}
                  minTickGap={32}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={(v) => `${Number(v).toFixed(1)}%`}
                  tick={{ fontSize: 10 }}
                  width={44}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  labelFormatter={(v) => new Date(Number(v) * 1000).toISOString().slice(0, 10)}
                  formatter={(v, name) => [
                    `${Number(v).toFixed(2)}%`,
                    name === 'target' ? 'Rate at target' : mode === 'borrow' ? 'Borrow APY' : 'Supply APY',
                  ]}
                />
                <Line
                  type="monotone"
                  dataKey="rate"
                  stroke={mode === 'borrow' ? BORROW_COLOR : SUPPLY_COLOR}
                  strokeWidth={2}
                  dot={false}
                />
                {mode === 'borrow' && (
                  <Line
                    type="monotone"
                    dataKey="target"
                    stroke={TARGET_COLOR}
                    strokeWidth={1}
                    strokeDasharray="4 3"
                    dot={false}
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
        <div className="space-y-1 rounded-xl border border-border p-3 text-sm">
          <p className="text-xs font-medium text-muted-foreground">Breakdown</p>
          <Row label="Instant">{current != null ? formatPercentage(current * 100) : '—'}</Row>
          <Row label="7D average">{fmtPct(avg(7))}</Row>
          <Row label="30D average">{fmtPct(avg(30))}</Row>
          <Row label="90D average">{fmtPct(avg(90))}</Row>
          <Row label="Rate at target">
            {activity.apyAtTarget != null ? formatPercentage(activity.apyAtTarget * 100) : '—'}
          </Row>
          {activity.fee != null && activity.fee > 0 && (
            <Row label="Market fee">{formatPercentage(activity.fee * 100)}</Row>
          )}
        </div>
      </div>

      <div className="grid gap-4 border-t border-border p-4 lg:grid-cols-[240px_1fr]">
        <div className="space-y-1 text-sm">
          <p className="text-xs font-medium text-muted-foreground">IRM breakdown</p>
          <Row label="Target utilization">{formatPercentage(target * 100)}</Row>
          <Row label="Current utilization">
            {utilization != null ? formatPercentage(utilization * 100) : '—'}
          </Row>
          <Row label={toTarget != null && toTarget < 0 ? 'Repay to reach target' : 'Borrow to reach target'}>
            {toTarget != null ? formatCompactUSD(Math.abs(toTarget)) : '—'}
          </Row>
          <Row label="Interest rate model">
            {irmAddress ? <ExplorerAddressLink address={irmAddress} chainId={chainId} /> : '—'}
          </Row>
        </div>
        {curve.length === 0 ? (
          <Empty>IRM curve unavailable</Empty>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={curve} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="u"
                type="number"
                domain={[0, 100]}
                tickFormatter={(v) => `${v}%`}
                tick={{ fontSize: 10 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tickFormatter={(v) => `${Number(v).toFixed(0)}%`}
                tick={{ fontSize: 10 }}
                width={40}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                labelFormatter={(v) => `Utilization ${Number(v).toFixed(1)}%`}
                formatter={(v, name) => [`${Number(v).toFixed(2)}%`, name === 'borrow' ? 'Borrow APY' : 'Supply APY']}
              />
              <ReferenceLine
                x={target * 100}
                stroke={TARGET_COLOR}
                strokeDasharray="4 3"
                label={{ value: `Target ${(target * 100).toFixed(0)}%`, fontSize: 10, position: 'insideTopLeft' }}
              />
              {utilization != null && (
                <ReferenceLine
                  x={utilization * 100}
                  stroke="#f59e0b"
                  label={{ value: `Now ${(utilization * 100).toFixed(1)}%`, fontSize: 10, position: 'insideBottomLeft' }}
                />
              )}
              <Line type="monotone" dataKey="borrow" stroke={BORROW_COLOR} strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="supply" stroke={SUPPLY_COLOR} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </CuratorPanel>
  );
}

function fmtPct(v: number | null): string {
  return v != null ? formatPercentage(v) : '—';
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/60 py-1 last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium tabular-nums">{children}</span>
    </div>
  );
}

/* --------------------------------------------------------- Collateral at risk */

export function CollateralAtRiskPanel({ activity }: { activity: MarketActivity }) {
  const data = activity.collateralAtRisk.map((p) => ({
    change: Math.round(p.priceChange * 100),
    usd: p.collateralUsd,
    positions: p.positions,
  }));
  const coverage = shareOf(activity.collateralAtRiskBorrowUsd, activity.marketBorrowUsd);
  // Morpho's points are 5% apart; the KPI tiles read the nearest point.
  const at = (pct: number) =>
    data.reduce<(typeof data)[number] | undefined>(
      (best, d) => (!best || Math.abs(d.change - pct) < Math.abs(best.change - pct) ? d : best),
      undefined
    );
  const hasAny = data.some((d) => d.usd > 0);
  const fromMorpho = activity.collateralAtRiskSource === 'morpho';

  return (
    <CuratorPanel
      title="Collateral at risk"
      description={
        fromMorpho
          ? 'Collateral that becomes liquidatable if the collateral price falls by each amount, across every position (Morpho).'
          : `Collateral that becomes liquidatable if the oracle price falls by each amount. Based on the largest borrowers${
              coverage != null
                ? ` (${formatPercentage(Math.min(coverage, 1) * 100, 1)} of market borrow)`
                : ''
            }.`
      }
    >
      <div className="space-y-3 p-4">
        <div className="grid gap-2 sm:grid-cols-4">
          {[-5, -10, -20, -30].map((pct) => {
            const point = at(pct);
            return (
              <div key={pct} className="rounded-lg border border-border px-3 py-2">
                <p className="text-xs text-muted-foreground">At {pct}%</p>
                <p className="font-medium tabular-nums">{formatCompactUSD(point?.usd ?? 0)}</p>
                {point?.positions != null && (
                  <p className="text-xs text-muted-foreground">{point.positions} positions</p>
                )}
              </div>
            );
          })}
        </div>
        {!hasAny ? (
          <Empty>No borrower becomes liquidatable within a 90% price drop.</Empty>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={[...data].reverse()} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="change"
                tickFormatter={(v) => `${v}%`}
                tick={{ fontSize: 10 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tickFormatter={(v) => formatCompactUSD(Number(v))}
                tick={{ fontSize: 10 }}
                width={64}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                labelFormatter={(v) => `Oracle price ${v}%`}
                formatter={(v) => [formatCompactUSD(Number(v)), 'Collateral at risk']}
              />
              <Area
                type="stepAfter"
                dataKey="usd"
                stroke="#ef4444"
                fill="#ef4444"
                fillOpacity={0.2}
                strokeWidth={2}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </CuratorPanel>
  );
}

/* --------------------------------------------------------------- Borrowers */

export function MarketBorrowersTable({
  activity,
  loan,
  collateral,
  chainId,
}: {
  activity: MarketActivity;
  loan: TokenMeta;
  collateral: TokenMeta;
  chainId: number;
}) {
  const totalBorrow = activity.marketBorrowUsd;
  const pager = usePage(activity.borrowers);
  return (
    <CuratorPanel
      title={`Borrowers${activity.borrowerCount != null ? ` (${activity.borrowerCount.toLocaleString()})` : ''}`}
      description="Largest positions by borrow. Health < 1 is liquidatable."
    >
      <div className="p-4">
        {activity.borrowers.length === 0 ? (
          <Empty>No open borrows.</Empty>
        ) : (
          <>
            <Table
              head={[
                { label: 'Borrower' },
                { label: 'Collateral', right: true },
                { label: 'Loan', right: true },
                { label: 'Health', right: true },
                { label: 'To liquidation', right: true },
                { label: 'Borrow share', right: true },
              ]}
            >
              {pager.rows.map((b) => {
                const share = shareOf(b.borrowAssetsUsd, totalBorrow);
                return (
                  <tr key={b.address}>
                    <td className={td}>
                      <ExplorerAddressLink address={b.address} chainId={chainId} />
                    </td>
                    <td className={cn(td, 'text-right')}>
                      <Amount raw={b.collateral} usd={b.collateralUsd} token={collateral} />
                    </td>
                    <td className={cn(td, 'text-right')}>
                      <Amount raw={b.borrowAssets} usd={b.borrowAssetsUsd} token={loan} />
                    </td>
                    <td className={cn(td, 'text-right tabular-nums', HEALTH_CLASS[healthTone(b.healthFactor)])}>
                      {b.healthFactor != null ? b.healthFactor.toFixed(3) : '—'}
                    </td>
                    <td className={cn(td, 'text-right tabular-nums')}>
                      {b.priceVariationToLiquidationPrice != null
                        ? formatPercentage(b.priceVariationToLiquidationPrice * 100, 1)
                        : '—'}
                    </td>
                    <td className={cn(td, 'text-right tabular-nums')}>
                      {share != null ? formatPercentage(share * 100) : '—'}
                    </td>
                  </tr>
                );
              })}
            </Table>
            <PaginationBar
              page={pager.page}
              totalPages={pager.totalPages}
              total={activity.borrowers.length}
              pageSize={PAGE_SIZE}
              onPage={pager.setPage}
            />
          </>
        )}
      </div>
    </CuratorPanel>
  );
}

/* --------------------------------------------------------------- Suppliers */

export function MarketSuppliersTable({
  activity,
  loan,
  supplyUsd,
  chainId,
}: {
  activity: MarketActivity;
  loan: TokenMeta;
  supplyUsd: number | null;
  chainId: number;
}) {
  const pager = usePage(activity.suppliers);
  const vaultByAdapterOrAddress = useMemo(() => {
    const m = new Map<string, string>();
    for (const v of activity.vaults) m.set(v.address.toLowerCase(), v.name);
    return m;
  }, [activity.vaults]);

  return (
    <CuratorPanel
      title={`Suppliers${activity.supplierCount != null ? ` (${activity.supplierCount.toLocaleString()})` : ''}`}
      description="Largest supply positions. V2 vaults supply through their adapter address."
    >
      <div className="p-4">
        {activity.suppliers.length === 0 ? (
          <Empty>No suppliers.</Empty>
        ) : (
          <>
            <Table
              head={[
                { label: 'Supplier' },
                { label: `Supply (${loan.symbol})`, right: true },
                { label: 'Supply share', right: true },
              ]}
            >
              {pager.rows.map((s) => {
                const share = shareOf(s.supplyAssetsUsd, supplyUsd);
                const vaultName = vaultByAdapterOrAddress.get(s.address.toLowerCase());
                return (
                  <tr key={s.address}>
                    <td className={td}>
                      <div className="flex items-center gap-2">
                        <ExplorerAddressLink address={s.address} chainId={chainId} />
                        {vaultName && <span className="text-xs text-muted-foreground">{vaultName}</span>}
                      </div>
                    </td>
                    <td className={cn(td, 'text-right')}>
                      <Amount raw={s.supplyAssets} usd={s.supplyAssetsUsd} token={loan} />
                    </td>
                    <td className={cn(td, 'text-right tabular-nums')}>
                      {share != null ? formatPercentage(share * 100) : '—'}
                    </td>
                  </tr>
                );
              })}
            </Table>
            <PaginationBar
              page={pager.page}
              totalPages={pager.totalPages}
              total={activity.suppliers.length}
              pageSize={PAGE_SIZE}
              onPage={pager.setPage}
            />
          </>
        )}
      </div>
    </CuratorPanel>
  );
}

/* ------------------------------------------------------------ Liquidations */

export function MarketLiquidationsTable({
  activity,
  loan,
  collateral,
  chainId,
}: {
  activity: MarketActivity;
  loan: TokenMeta;
  collateral: TokenMeta;
  chainId: number;
}) {
  const pager = usePage(activity.liquidations);
  return (
    <CuratorPanel title="Liquidations" description="Most recent first (up to 100).">
      <div className="p-4">
        {activity.liquidations.length === 0 ? (
          <Empty>No liquidation has been executed.</Empty>
        ) : (
          <>
            <Table
              head={[
                { label: 'Date (UTC)' },
                { label: 'Borrower' },
                { label: 'Liquidator' },
                { label: 'Repaid', right: true },
                { label: 'Seized', right: true },
                { label: 'Bad debt', right: true },
                { label: 'Tx', right: true },
              ]}
            >
              {pager.rows.map((l, i) => {
                const badDebt = l.badDebtAssets && l.badDebtAssets !== '0';
                return (
                  <tr key={`${l.txHash}-${i}`}>
                    <td className={cn(td, 'tabular-nums')}>
                      {new Date(l.timestamp * 1000).toISOString().slice(0, 16).replace('T', ' ')}
                    </td>
                    <td className={td}>
                      {l.borrower ? <ExplorerAddressLink address={l.borrower} chainId={chainId} /> : '—'}
                    </td>
                    <td className={td}>
                      {l.liquidator ? <ExplorerAddressLink address={l.liquidator} chainId={chainId} /> : '—'}
                    </td>
                    <td className={cn(td, 'text-right tabular-nums')}>
                      {formatMarketTokenAmount(l.repaidAssets, loan.symbol, loan.decimals) ?? '—'}
                    </td>
                    <td className={cn(td, 'text-right tabular-nums')}>
                      {formatMarketTokenAmount(l.seizedAssets, collateral.symbol, collateral.decimals) ?? '—'}
                    </td>
                    <td className={cn(td, 'text-right tabular-nums', badDebt && 'text-red-600 dark:text-red-400')}>
                      {badDebt ? formatMarketTokenAmount(l.badDebtAssets, loan.symbol, loan.decimals) : '—'}
                    </td>
                    <td className={cn(td, 'text-right')}>
<ExplorerTxLink hash={l.txHash} chainId={chainId} />
                    </td>
                  </tr>
                );
              })}
            </Table>
            <PaginationBar
              page={pager.page}
              totalPages={pager.totalPages}
              total={activity.liquidations.length}
              pageSize={PAGE_SIZE}
              onPage={pager.setPage}
            />
          </>
        )}
      </div>
    </CuratorPanel>
  );
}

/* ------------------------------------------------------------------ Vaults */

export function MarketListingVaultsTable({
  activity,
  loan,
  chainId,
}: {
  activity: MarketActivity;
  loan: TokenMeta;
  chainId: number;
}) {
  const pager = usePage(activity.vaults);
  return (
    <CuratorPanel
      title={`Vaults supplying this market (${activity.vaults.length})`}
      description="Muscadine vaults link to their vault page."
    >
      <div className="p-4">
        {activity.vaults.length === 0 ? (
          <Empty>No vault supplies this market.</Empty>
        ) : (
          <>
            <Table
              head={[
                { label: 'Vault' },
                { label: 'Version' },
                { label: 'Curator' },
                { label: 'Allocation', right: true },
              ]}
            >
              {pager.rows.map((v) => {
                const ours = getVaultByAddress(v.address);
                return (
                  <tr key={v.address} className={cn(ours && 'bg-blue-50/60 dark:bg-blue-950/20')}>
                    <td className={td}>
                      <div className="flex flex-col">
                        {ours ? (
                          <Link href={`/vault/${v.address}`} className="font-medium hover:underline">
                            {v.name}
                          </Link>
                        ) : (
                          <span className="font-medium">{v.name}</span>
                        )}
                        <ExplorerAddressLink address={v.address} chainId={chainId} />
                      </div>
                    </td>
                    <td className={td}>
                      <Badge variant="secondary" className="text-[10px] uppercase">
                        {v.version}
                      </Badge>
                    </td>
                    <td className={cn(td, 'text-xs')}>
                      {v.curator ? (
                        /^0x[0-9a-fA-F]{40}$/.test(v.curator) ? (
                          <ExplorerAddressLink address={v.curator} chainId={chainId} />
                        ) : (
                          v.curator
                        )
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className={cn(td, 'text-right')}>
                      {v.allocation != null ? (
                        <Amount raw={v.allocation} usd={v.allocationUsd} token={loan} />
                      ) : (
                        <span className="text-xs text-muted-foreground">Not in top suppliers</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </Table>
            <PaginationBar
              page={pager.page}
              totalPages={pager.totalPages}
              total={activity.vaults.length}
              pageSize={PAGE_SIZE}
              onPage={pager.setPage}
            />
          </>
        )}
      </div>
    </CuratorPanel>
  );
}
