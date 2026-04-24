'use client';

import { useMemo, useState } from 'react';
import { Users, ExternalLink, ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useVaultHolders } from '@/lib/hooks/useVaultHolders';
import {
  formatAddress,
  formatRawTokenAmount,
  formatFullUSD,
  formatNumber,
} from '@/lib/format/number';
import { getScanUrlForChain } from '@/lib/constants';

interface VaultHoldersProps {
  vaultAddress: string;
  chainId: number;
  /** Upper bound on holders to request from the API. */
  limit?: number;
  /** How many holders to show per page. Default 10. */
  pageSize?: number;
  /**
   * Asset decimals / symbol from the parent page. Used as a fallback when the
   * holders endpoint doesn't return asset info (the V1 GraphQL query doesn't).
   * Without this, V1 vaults render all token amounts as "0.000" because we'd
   * default to 18-decimals while USDC is 6-decimals.
   */
  assetDecimals?: number | null;
  assetSymbol?: string | null;
}

export function VaultHolders({
  vaultAddress,
  chainId,
  limit = 500,
  pageSize = 10,
  assetDecimals,
  assetSymbol,
}: VaultHoldersProps) {
  const { data, isLoading, error } = useVaultHolders(vaultAddress, limit);
  const scanUrl = getScanUrlForChain(chainId);

  const holders = data?.holders ?? [];
  const totalHolders = data?.totalHolders ?? 0;
  // Prefer API-reported asset info; fall back to parent-provided props.
  const decimals = data?.asset.decimals ?? assetDecimals ?? 18;
  const symbol = data?.asset.symbol ?? assetSymbol ?? '';

  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(holders.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const pagedHolders = useMemo(
    () => holders.slice(safePage * pageSize, safePage * pageSize + pageSize),
    [holders, safePage, pageSize]
  );

  const rangeStart = holders.length === 0 ? 0 : safePage * pageSize + 1;
  const rangeEnd = Math.min(holders.length, (safePage + 1) * pageSize);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Holders
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-xs">
              {isLoading ? '…' : `${formatNumber(totalHolders)} total`}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : error ? (
          <p className="text-sm text-red-600 dark:text-red-400">
            Failed to load holders: {error instanceof Error ? error.message : 'Unknown error'}
          </p>
        ) : pagedHolders.length === 0 ? (
          <p className="text-sm text-muted-foreground">No holders yet.</p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead className="text-right">
                    Assets{symbol ? ` (${symbol})` : ''}
                  </TableHead>
                  <TableHead className="text-right">USD</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagedHolders.map((h, i) => {
                  const rank = safePage * pageSize + i + 1;
                  return (
                    <TableRow key={h.address}>
                      <TableCell className="text-xs text-muted-foreground">{rank}</TableCell>
                      <TableCell>
                        <Link
                          href={`${scanUrl}/address/${h.address}`}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-xs text-blue-600 hover:underline dark:text-blue-400"
                        >
                          {formatAddress(h.address, 8, 6)}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {h.assets
                          ? formatRawTokenAmount(h.assets, decimals, decimals >= 8 ? 4 : 2)
                          : '—'}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {h.assetsUsd != null ? formatFullUSD(h.assetsUsd) : '—'}
                      </TableCell>
                      <TableCell>
                        <a
                          href={`${scanUrl}/address/${h.address}`}
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

            {holders.length > pageSize && (
              <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  Showing {rangeStart}–{rangeEnd} of {holders.length}
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
