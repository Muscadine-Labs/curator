'use client';

import { Fragment, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  ArrowDownLeft,
  ArrowUpRight,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  useProtocolUsers,
  useProtocolTransactions,
} from '@/lib/hooks/useProtocolUsers';
import type { ProtocolStats } from '@/lib/hooks/useProtocolStats';
import { useRevenueSource } from '@/lib/RevenueSourceContext';
import { getVaultPageHref } from '@/lib/config/vaults';
import {
  formatAddress,
  formatFullUSD,
  formatRawTokenAmount,
  formatRelativeTime,
  formatUSD,
} from '@/lib/format/number';
import { getTokenDisplayDecimals } from '@/lib/format/asset-decimals';
import { getScanUrlForChain, BASE_CHAIN_ID } from '@/lib/constants';
import { DepositorAddress } from '@/components/DepositorAddress';

export type ProtocolStatKey = 'tvl' | 'fees' | 'users' | 'vaults';

const PAGE_SIZE = 10;

function prettyType(type: string): string {
  return type
    .replace(/^MetaMorpho/, '')
    .replace(/^Vault/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2');
}

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

function UsersDetail() {
  const { data, isLoading, error } = useProtocolUsers();
  const { data: txData, isLoading: txLoading } = useProtocolTransactions();
  const [userPage, setUserPage] = useState(0);
  const [txPage, setTxPage] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const scanUrl = getScanUrlForChain(BASE_CHAIN_ID);

  const users = useMemo(() => data?.users ?? [], [data?.users]);
  const userTotalPages = Math.max(1, Math.ceil(users.length / PAGE_SIZE));
  const safeUserPage = Math.min(userPage, userTotalPages - 1);
  const pagedUsers = useMemo(
    () => users.slice(safeUserPage * PAGE_SIZE, safeUserPage * PAGE_SIZE + PAGE_SIZE),
    [users, safeUserPage]
  );

  const txs = useMemo(() => txData?.transactions ?? [], [txData?.transactions]);
  const txTotalPages = Math.max(1, Math.ceil(txs.length / PAGE_SIZE));
  const safeTxPage = Math.min(txPage, txTotalPages - 1);
  const pagedTxs = useMemo(
    () => txs.slice(safeTxPage * PAGE_SIZE, safeTxPage * PAGE_SIZE + PAGE_SIZE),
    [txs, safeTxPage]
  );

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold">Top holders</h3>
        <p className="text-xs text-muted-foreground">
          Unique depositors across active vaults · tap a row for vault holdings
          (token + USD) · {PAGE_SIZE} / page
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : error ? (
        <p className="text-sm text-red-600 dark:text-red-400">Failed to load users.</p>
      ) : users.length === 0 ? (
        <p className="text-sm text-muted-foreground">No users found.</p>
      ) : (
        <>
          {/* Mobile cards */}
          <div className="space-y-2 sm:hidden">
            {pagedUsers.map((u, i) => {
              const rank = safeUserPage * PAGE_SIZE + i + 1;
              const isOpen = expanded === u.address.toLowerCase();
              return (
                <div
                  key={u.address}
                  className="rounded-md border border-border/60"
                >
                  <button
                    type="button"
                    className="flex w-full touch-manipulation items-start justify-between gap-3 px-3 py-2.5 text-left"
                    onClick={() =>
                      setExpanded(isOpen ? null : u.address.toLowerCase())
                    }
                  >
                    <div className="min-w-0 space-y-0.5">
                      <p className="text-[10px] text-muted-foreground">#{rank}</p>
                      <DepositorAddress address={u.address} startChars={6} endChars={4} />
                      <p className="text-[11px] text-muted-foreground">
                        {u.vaultCount} vault{u.vaultCount === 1 ? '' : 's'}
                      </p>
                    </div>
                    <p className="shrink-0 font-mono text-xs tabular-nums">
                      {formatFullUSD(u.totalUsd)}
                    </p>
                  </button>
                  {isOpen && (
                    <div className="space-y-2 border-t border-border/60 bg-muted/30 px-3 py-2">
                      {u.positions.map((p) => {
                        const decimals = p.assetDecimals ?? 18;
                        const display = getTokenDisplayDecimals(
                          p.assetSymbol,
                          decimals
                        );
                        return (
                          <div
                            key={`${u.address}-${p.vaultAddress}`}
                            className="flex items-start justify-between gap-2 text-xs"
                          >
                            <Link
                              href={`/vault/${p.vaultAddress}`}
                              className="min-w-0 font-medium hover:underline"
                            >
                              {p.vaultName}
                            </Link>
                            <div className="shrink-0 text-right tabular-nums">
                              <p>
                                {p.assets
                                  ? `${formatRawTokenAmount(p.assets, decimals, display)} ${p.assetSymbol}`
                                  : '—'}
                              </p>
                              <p className="text-muted-foreground">
                                {p.assetsUsd != null
                                  ? formatFullUSD(p.assetsUsd)
                                  : '—'}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                      <a
                        href={`${scanUrl}/address/${u.address}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] text-blue-600 hover:underline dark:text-blue-400"
                      >
                        Explorer <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Desktop table */}
          <div className="hidden sm:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">#</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead className="text-right">Vaults</TableHead>
                  <TableHead className="text-right">Total USD</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagedUsers.map((u, i) => {
                  const rank = safeUserPage * PAGE_SIZE + i + 1;
                  const isOpen = expanded === u.address.toLowerCase();
                  return (
                    <Fragment key={u.address}>
                      <TableRow
                        className="cursor-pointer"
                        onClick={() =>
                          setExpanded(isOpen ? null : u.address.toLowerCase())
                        }
                      >
                        <TableCell className="text-xs text-muted-foreground">
                          {rank}
                        </TableCell>
                        <TableCell>
                          <DepositorAddress
                            address={u.address}
                            href={`${scanUrl}/address/${u.address}`}
                            startChars={8}
                            endChars={6}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-xs">
                          {u.vaultCount}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {formatFullUSD(u.totalUsd)}
                        </TableCell>
                      </TableRow>
                      {isOpen && (
                        <TableRow>
                          <TableCell colSpan={4} className="bg-muted/30">
                            <div className="space-y-2 py-1">
                              {u.positions.map((p) => {
                                const decimals = p.assetDecimals ?? 18;
                                const display = getTokenDisplayDecimals(
                                  p.assetSymbol,
                                  decimals
                                );
                                return (
                                  <div
                                    key={`${u.address}-${p.vaultAddress}`}
                                    className="flex flex-wrap items-center justify-between gap-2 text-xs"
                                  >
                                    <Link
                                      href={`/vault/${p.vaultAddress}`}
                                      className="font-medium hover:underline"
                                    >
                                      {p.vaultName}
                                    </Link>
                                    <div className="text-right tabular-nums">
                                      <p>
                                        {p.assets
                                          ? `${formatRawTokenAmount(p.assets, decimals, display)} ${p.assetSymbol}`
                                          : '—'}
                                      </p>
                                      <p className="text-muted-foreground">
                                        {p.assetsUsd != null
                                          ? formatFullUSD(p.assetsUsd)
                                          : '—'}
                                      </p>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <Pagination
            page={safeUserPage}
            totalPages={userTotalPages}
            total={users.length}
            pageSize={PAGE_SIZE}
            onPage={setUserPage}
          />
        </>
      )}

      <div className="border-t border-border/60 pt-4">
        <h3 className="text-sm font-semibold">Latest transactions</h3>
        <p className="text-xs text-muted-foreground">
          Deposits / withdraws across all active vaults · {PAGE_SIZE} / page
        </p>
      </div>

      {txLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : pagedTxs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No recent transactions.</p>
      ) : (
        <>
          <div className="space-y-2 sm:hidden">
            {pagedTxs.map((tx, i) => {
              const decimals = tx.assetDecimals ?? 18;
              const display = getTokenDisplayDecimals(tx.assetSymbol, decimals);
              const kind = tx.type.toLowerCase();
              const deposit = kind.includes('deposit');
              const withdraw = kind.includes('withdraw');
              return (
                <div
                  key={`${tx.hash}-${tx.vaultAddress}-${tx.type}-${i}`}
                  className="rounded-md border border-border/60 px-3 py-2.5"
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge
                      variant="outline"
                      className={
                        deposit
                          ? 'border-emerald-500/30 text-emerald-700 dark:text-emerald-400'
                          : withdraw
                            ? 'border-rose-500/30 text-rose-700 dark:text-rose-400'
                            : 'text-muted-foreground'
                      }
                    >
                      {deposit ? (
                        <ArrowDownLeft className="mr-1 h-3 w-3" />
                      ) : withdraw ? (
                        <ArrowUpRight className="mr-1 h-3 w-3" />
                      ) : null}
                      {prettyType(tx.type)}
                    </Badge>
                    <span className="text-[11px] text-muted-foreground">
                      {tx.timestamp
                        ? formatRelativeTime(new Date(tx.timestamp * 1000))
                        : '—'}
                    </span>
                  </div>
                  <Link
                    href={`/vault/${tx.vaultAddress}`}
                    className="mt-1 block text-xs font-medium hover:underline"
                  >
                    {tx.vaultName}
                  </Link>
                  <div className="mt-1 flex items-end justify-between gap-2">
                    {tx.user ? (
                      <DepositorAddress address={tx.user} startChars={6} endChars={4} />
                    ) : (
                      <span className="font-mono text-[11px] text-muted-foreground">—</span>
                    )}
                    <div className="text-right text-xs tabular-nums">
                      <p>
                        {tx.assets
                          ? `${formatRawTokenAmount(tx.assets, decimals, display)} ${tx.assetSymbol}`
                          : '—'}
                      </p>
                      {tx.assetsUsd != null && (
                        <p className="text-muted-foreground">
                          {formatFullUSD(tx.assetsUsd)}
                        </p>
                      )}
                    </div>
                  </div>
                  <a
                    href={`${scanUrl}/tx/${tx.hash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1.5 inline-flex items-center gap-1 font-mono text-[10px] text-blue-600 hover:underline dark:text-blue-400"
                  >
                    {formatAddress(tx.hash, 8, 6)}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              );
            })}
          </div>

          <div className="hidden sm:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Vault</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="w-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagedTxs.map((tx, i) => {
                  const decimals = tx.assetDecimals ?? 18;
                  const display = getTokenDisplayDecimals(tx.assetSymbol, decimals);
                  const kind = tx.type.toLowerCase();
                  const deposit = kind.includes('deposit');
                  const withdraw = kind.includes('withdraw');
                  return (
                    <TableRow
                      key={`${tx.hash}-${tx.vaultAddress}-${tx.type}-${i}`}
                    >
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {tx.timestamp
                          ? formatRelativeTime(new Date(tx.timestamp * 1000))
                          : '—'}
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/vault/${tx.vaultAddress}`}
                          className="text-xs font-medium hover:underline"
                        >
                          {tx.vaultName}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            deposit
                              ? 'border-emerald-500/30 text-emerald-700 dark:text-emerald-400'
                              : withdraw
                                ? 'border-rose-500/30 text-rose-700 dark:text-rose-400'
                                : 'text-muted-foreground'
                          }
                        >
                          {deposit ? (
                            <ArrowDownLeft className="mr-1 h-3 w-3" />
                          ) : withdraw ? (
                            <ArrowUpRight className="mr-1 h-3 w-3" />
                          ) : null}
                          {prettyType(tx.type)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {tx.user ? (
                          <DepositorAddress
                            address={tx.user}
                            href={`${scanUrl}/address/${tx.user}`}
                            startChars={6}
                            endChars={4}
                          />
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">
                        <p>
                          {tx.assets
                            ? `${formatRawTokenAmount(tx.assets, decimals, display)} ${tx.assetSymbol}`
                            : '—'}
                        </p>
                        {tx.assetsUsd != null && (
                          <p className="text-muted-foreground">
                            {formatFullUSD(tx.assetsUsd)}
                          </p>
                        )}
                      </TableCell>
                      <TableCell>
                        <a
                          href={`${scanUrl}/tx/${tx.hash}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
                          aria-label="View transaction"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <Pagination
            page={safeTxPage}
            totalPages={txTotalPages}
            total={txs.length}
            pageSize={PAGE_SIZE}
            onPage={setTxPage}
          />
        </>
      )}
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
                {new Date(d.date).toLocaleDateString()}
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
        kind: 'strategy' as const,
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
          {stats.activeVaults} active vaults including fee wrappers
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
              {row.kind === 'feeWrapper' && (
                <p className="text-[10px] text-muted-foreground">Fee wrapper</p>
              )}
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
              <TableHead>Kind</TableHead>
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
                <TableCell>
                  <Badge variant="secondary" className="text-[10px] font-normal">
                    {row.kind === 'feeWrapper' ? 'Fee wrapper' : 'Strategy'}
                  </Badge>
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
    users: 'Users detail',
    vaults: 'Active vaults',
  };

  return (
    <Card className="border-border/70 overflow-hidden">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">{titles[selected]}</CardTitle>
      </CardHeader>
      <CardContent className="min-w-0">
        {selected === 'users' && <UsersDetail />}
        {selected === 'tvl' && stats && <TvlDetail stats={stats} />}
        {selected === 'fees' && stats && <FeesDetail stats={stats} />}
        {selected === 'vaults' && stats && <VaultsDetail stats={stats} />}
        {(selected === 'tvl' || selected === 'fees' || selected === 'vaults') &&
          !stats && <Skeleton className="h-24 w-full" />}
      </CardContent>
    </Card>
  );
}
