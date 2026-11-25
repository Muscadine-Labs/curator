'use client';

import { Fragment, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { ProtocolStats } from '@/lib/hooks/useProtocolStats';
import { useRevenueSource } from '@/lib/RevenueSourceContext';
import { getVaultPageHref } from '@/lib/config/vaults';
import {
  formatFullUSD,
  formatUSD,
} from '@/lib/format/number';
import { formatUtcTooltipDate } from '@/lib/utils/utc-calendar';

export type ProtocolStatKey = 'tvl' | 'fees' | 'vaults';

const PAGE_SIZE = 10;

function Pagination({
  page,
  totalPages,
  total,
  pageSize,
  onPage,
}: {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  onPage: (p: number) => void;
}) {
  if (total <= pageSize) return null;
  const rangeStart = page * pageSize + 1;
  const rangeEnd = Math.min(total, (page + 1) * pageSize);
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
      <span className="min-w-0">
        Showing {rangeStart}–{rangeEnd} of {total}
      </span>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onPage(Math.max(0, page - 1))}
          disabled={page === 0}
          className="h-9 w-9 touch-manipulation p-0 sm:h-7 sm:w-7"
          aria-label="Previous page"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        <span className="min-w-[3.5rem] text-center tabular-nums">
          {page + 1} / {totalPages}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onPage(Math.min(totalPages - 1, page + 1))}
          disabled={page >= totalPages - 1}
          className="h-9 w-9 touch-manipulation p-0 sm:h-7 sm:w-7"
          aria-label="Next page"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

function TvlDetail({ stats }: { stats: ProtocolStats }) {
  const { revenueSource } = useRevenueSource();
  const isDefillama = revenueSource === 'defillama';
  const [page, setPage] = useState(0);
  const rows = useMemo(() => {
    if (isDefillama) {
      return (stats.tvlByTokenDefillama ?? [])
        .map((v) => {
          const latest = v.data[v.data.length - 1];
          return {
            name: v.name,
            address: v.address,
            tvl: latest?.value ?? 0,
            href: null as string | null,
          };
        })
        .sort((a, b) => b.tvl - a.tvl);
    }
    return (stats.tvlByVault ?? [])
      .map((v) => {
        const latest = v.data[v.data.length - 1];
        return {
          name: v.name,
          address: v.address,
          tvl: latest?.value ?? 0,
          href: getVaultPageHref(v.address),
        };
      })
      .sort((a, b) => b.tvl - a.tvl);
  }, [isDefillama, stats.tvlByTokenDefillama, stats.tvlByVault]);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const paged = rows.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const totalTvl = isDefillama ? (stats.defillamaTvl ?? 0) : stats.totalDeposited;

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">{isDefillama ? 'TVL by token' : 'TVL by vault'}</h3>
        <p className="text-xs text-muted-foreground">
          {isDefillama ? 'DefiLlama' : 'Protocol'} TVL {formatUSD(totalTvl)} across {rows.length}{' '}
          {isDefillama ? 'tokens' : 'vaults'}
        </p>
      </div>
      <div className="space-y-2 sm:hidden">
        {paged.map((row, i) => {
          const inner = (
            <>
              <div className="min-w-0">
                <p className="text-[10px] text-muted-foreground">
                  #{safePage * PAGE_SIZE + i + 1}
                </p>
                <p className="truncate text-sm font-medium">{row.name}</p>
              </div>
              <p className="shrink-0 font-mono text-xs tabular-nums">
                {formatFullUSD(row.tvl)}
              </p>
            </>
          );
          return row.href ? (
            <Link
              key={row.address}
              href={row.href}
              className="flex items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2.5"
            >
              {inner}
            </Link>
          ) : (
            <div
              key={row.address}
              className="flex items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2.5"
            >
              {inner}
            </div>
          );
        })}
      </div>
      <div className="hidden sm:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>#</TableHead>
              <TableHead>{isDefillama ? 'Token' : 'Vault'}</TableHead>
              <TableHead className="text-right">TVL</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paged.map((row, i) => (
              <TableRow key={row.address}>
                <TableCell className="text-xs text-muted-foreground">
                  {safePage * PAGE_SIZE + i + 1}
                </TableCell>
                <TableCell>
                  {row.href ? (
                    <Link href={row.href} className="text-sm font-medium hover:underline">
                      {row.name}
                    </Link>
                  ) : (
                    <span className="text-sm font-medium">{row.name}</span>
                  )}
                </TableCell>
                <TableCell className="text-right font-mono text-xs">
                  {formatFullUSD(row.tvl)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Pagination
        page={safePage}
        totalPages={totalPages}
        total={rows.length}
        pageSize={PAGE_SIZE}
        onPage={setPage}
      />
    </div>
  );
}

function FeesDetail({ stats }: { stats: ProtocolStats }) {
  const recent = useMemo(() => {
    return [...(stats.feesTrendDaily ?? [])].slice(-30).reverse();
  }, [stats.feesTrendDaily]);
  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(recent.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const paged = recent.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">Fees</h3>
        <p className="text-xs text-muted-foreground">
          All-time fees {formatUSD(stats.totalInterestGenerated)} · last 30 daily points
        </p>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead className="text-right">Daily fees</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {paged.map((d) => (
            <TableRow key={d.date}>
              <TableCell className="text-xs">
                {formatUtcTooltipDate(d.date)}
              </TableCell>
              <TableCell className="text-right font-mono text-xs">
                {formatFullUSD(d.value)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Pagination
        page={safePage}
        totalPages={totalPages}
        total={recent.length}
        pageSize={PAGE_SIZE}
        onPage={setPage}
      />
    </div>
  );
}

function VaultsDetail({ stats }: { stats: ProtocolStats }) {
  const [page, setPage] = useState(0);
  const rows = useMemo(() => {
    const list = stats.activeVaultsList;
    if (list && list.length > 0) {
      return [...list].sort((a, b) => b.tvl - a.tvl);
    }
    return (stats.tvlByVault ?? [])
      .map((v) => ({
        name: v.name,
        address: v.address,
        tvl: v.data[v.data.length - 1]?.value ?? 0,
      }))
      .sort((a, b) => b.tvl - a.tvl);
  }, [stats.activeVaultsList, stats.tvlByVault]);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const paged = rows.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">Active vaults</h3>
        <p className="text-xs text-muted-foreground">
          {stats.activeVaults} active vaults
        </p>
      </div>
      <div className="space-y-2 sm:hidden">
        {paged.map((row, i) => (
          <Link
            key={row.address}
            href={getVaultPageHref(row.address)}
            className="flex items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2.5"
          >
            <div className="min-w-0">
              <p className="text-[10px] text-muted-foreground">
                #{safePage * PAGE_SIZE + i + 1}
              </p>
              <p className="truncate text-sm font-medium">{row.name}</p>
            </div>
            <p className="shrink-0 font-mono text-xs tabular-nums">
              {formatFullUSD(row.tvl)}
            </p>
          </Link>
        ))}
      </div>
      <div className="hidden sm:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>#</TableHead>
              <TableHead>Vault</TableHead>
              <TableHead className="text-right">TVL</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paged.map((row, i) => (
              <TableRow key={row.address}>
                <TableCell className="text-xs text-muted-foreground">
                  {safePage * PAGE_SIZE + i + 1}
                </TableCell>
                <TableCell>
                  <Link
                    href={getVaultPageHref(row.address)}
                    className="text-sm font-medium hover:underline"
                  >
                    {row.name}
                  </Link>
                </TableCell>
                <TableCell className="text-right font-mono text-xs">
                  {formatFullUSD(row.tvl)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Pagination
        page={safePage}
        totalPages={totalPages}
        total={rows.length}
        pageSize={PAGE_SIZE}
        onPage={setPage}
      />
    </div>
  );
}

export function ProtocolStatsDetail({
  selected,
  stats,
}: {
  selected: ProtocolStatKey;
  stats: ProtocolStats | undefined;
}) {
  const titles: Record<ProtocolStatKey, string> = {
    tvl: 'TVL detail',
    fees: 'Fees detail',
    vaults: 'Active vaults',
  };

  return (
    <Card className="border-border/70 overflow-hidden">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">{titles[selected]}</CardTitle>
      </CardHeader>
      <CardContent className="min-w-0">
        {selected === 'tvl' && stats && <TvlDetail stats={stats} />}
        {selected === 'fees' && stats && <FeesDetail stats={stats} />}
        {selected === 'vaults' && stats && <VaultsDetail stats={stats} />}
        {(selected === 'tvl' || selected === 'fees' || selected === 'vaults') &&
          !stats && <Skeleton className="h-24 w-full" />}
      </CardContent>
    </Card>
  );
}
