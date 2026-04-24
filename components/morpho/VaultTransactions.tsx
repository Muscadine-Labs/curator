'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Filter,
} from 'lucide-react';
import Link from 'next/link';
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
import { useVaultTransactions } from '@/lib/hooks/useVaultTransactions';
import {
  formatAddress,
  formatRawTokenAmount,
  formatFullUSD,
  formatRelativeTime,
} from '@/lib/format/number';
import { getScanUrlForChain } from '@/lib/constants';

interface VaultTransactionsProps {
  vaultAddress: string;
  chainId: number;
  assetDecimals: number | null | undefined;
  assetSymbol: string | null | undefined;
  limit?: number;
  /** Rows per page; default 10. */
  pageSize?: number;
}

type TxFilter = 'all' | 'deposit' | 'withdraw' | 'other';

function classifyType(type: string): TxFilter {
  const t = type.toLowerCase();
  if (t.includes('deposit')) return 'deposit';
  if (t.includes('withdraw')) return 'withdraw';
  return 'other';
}

function prettyType(type: string): string {
  return type
    .replace(/^MetaMorpho/, '')
    .replace(/^Vault/, '')
    .replace(/^([A-Z])/, (s) => s)
    .replace(/([a-z])([A-Z])/g, '$1 $2');
}

function txKindBadge(type: string) {
  const kind = classifyType(type);
  if (kind === 'deposit') {
    return (
      <Badge variant="outline" className="border-emerald-500/30 text-emerald-700 dark:text-emerald-400">
        <ArrowDownLeft className="mr-1 h-3 w-3" />
        {prettyType(type)}
      </Badge>
    );
  }
  if (kind === 'withdraw') {
    return (
      <Badge variant="outline" className="border-rose-500/30 text-rose-700 dark:text-rose-400">
        <ArrowUpRight className="mr-1 h-3 w-3" />
        {prettyType(type)}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-muted-foreground">
      {prettyType(type)}
    </Badge>
  );
}

export function VaultTransactions({
  vaultAddress,
  chainId,
  assetDecimals,
  assetSymbol,
  limit = 100,
  pageSize = 10,
}: VaultTransactionsProps) {
  const { data, isLoading, error } = useVaultTransactions(vaultAddress, limit);
  const [filter, setFilter] = useState<TxFilter>('all');
  const [page, setPage] = useState(0);
  const scanUrl = getScanUrlForChain(chainId);

  const txs = data?.transactions ?? [];
  const filtered = useMemo(() => {
    if (filter === 'all') return txs;
    return txs.filter((t) => classifyType(t.type) === filter);
  }, [txs, filter]);

  // Reset to first page whenever the filter changes so users don't land on an
  // empty tail page.
  useEffect(() => {
    setPage(0);
  }, [filter]);

  const decimals = assetDecimals ?? 18;
  const symbol = assetSymbol ?? '';

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const paged = useMemo(
    () => filtered.slice(safePage * pageSize, safePage * pageSize + pageSize),
    [filtered, safePage, pageSize]
  );
  const rangeStart = filtered.length === 0 ? 0 : safePage * pageSize + 1;
  const rangeEnd = Math.min(filtered.length, (safePage + 1) * pageSize);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="flex items-center gap-2">
            Recent Transactions
            <Badge variant="secondary" className="text-xs">
              {isLoading ? '…' : `${filtered.length} match${filtered.length === 1 ? '' : 'es'}`}
            </Badge>
          </CardTitle>
          <div className="flex flex-wrap items-center gap-1">
            <Filter className="mr-1 h-4 w-4 text-muted-foreground" />
            {(['all', 'deposit', 'withdraw', 'other'] as TxFilter[]).map((f) => (
              <Button
                key={f}
                size="sm"
                variant={filter === f ? 'default' : 'outline'}
                onClick={() => setFilter(f)}
                className="capitalize"
              >
                {f}
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : error ? (
          <p className="text-sm text-red-600 dark:text-red-400">
            Failed to load transactions: {error instanceof Error ? error.message : 'Unknown error'}
          </p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">No transactions match the selected filter.</p>
        ) : (
          <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>User</TableHead>
                <TableHead className="text-right">
                  Assets{symbol ? ` (${symbol})` : ''}
                </TableHead>
                <TableHead className="text-right">USD</TableHead>
                <TableHead>When</TableHead>
                <TableHead className="w-10">Tx</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paged.map((tx, i) => {
                const timestampMs = tx.timestamp != null ? tx.timestamp * 1000 : null;
                // The Morpho API can emit multiple transaction rows that
                // share the same tx hash (e.g. a multicall that performs both
                // a deposit and a withdraw, or an internal call that re-emits
                // the event). React keys must be unique, so we compose
                // `hash:type:user:index` — index alone would still be unique
                // but degrades reconciliation when the page changes; this
                // composite stays stable across renders of the same dataset.
                const rowKey = `${tx.hash}:${tx.type}:${tx.user ?? 'noUser'}:${
                  safePage * pageSize + i
                }`;
                return (
                  <TableRow key={rowKey}>
                    <TableCell>{txKindBadge(tx.type)}</TableCell>
                    <TableCell>
                      {tx.user ? (
                        <Link
                          href={`${scanUrl}/address/${tx.user}`}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-xs text-blue-600 hover:underline dark:text-blue-400"
                        >
                          {formatAddress(tx.user, 6, 4)}
                        </Link>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {tx.assets
                        ? formatRawTokenAmount(tx.assets, decimals, decimals >= 8 ? 4 : 2)
                        : '—'}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {tx.assetsUsd != null ? formatFullUSD(tx.assetsUsd) : '—'}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {timestampMs ? formatRelativeTime(new Date(timestampMs)) : '—'}
                    </TableCell>
                    <TableCell>
                      <a
                        href={`${scanUrl}/tx/${tx.hash}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
                        aria-label="View on explorer"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          {filtered.length > pageSize && (
            <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
              <span>
                Showing {rangeStart}–{rangeEnd} of {filtered.length}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={safePage === 0}
                  aria-label="Previous page"
                  className="h-7 w-7 p-0"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <span className="tabular-nums">
                  {safePage + 1} / {totalPages}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={safePage >= totalPages - 1}
                  aria-label="Next page"
                  className="h-7 w-7 p-0"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
