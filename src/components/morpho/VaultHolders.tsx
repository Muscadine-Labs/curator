'use client';

import { useEffect, useMemo, useState } from 'react';
import { Users, ExternalLink } from 'lucide-react';
import { PaginationBar } from '@/components/ui/pagination-bar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CollapsibleCard } from '@/components/ui/collapsible-card';
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
import { useVaultHolders } from '@/lib/hooks/useVaultHolders';
import { DepositorAddress } from '@/components/DepositorAddress';
import {
  formatRawTokenAmount,
  formatFullUSD,
  formatNumber,
} from '@/lib/format/number';
import { getTokenDisplayDecimals } from '@/lib/format/asset-decimals';
import { getScanUrlForChain } from '@/lib/constants';
import { CuratorTableShell } from '@/components/morpho/CuratorChrome';

interface VaultHoldersProps {
  vaultAddress: string;
  chainId: number;
  /** Upper bound on holders to request from the API. */
  limit?: number;
  /** How many holders to show per page. Default 10. */
  pageSize?: number;
  /**
   * Asset decimals / symbol from the parent page when the holders API omits them.
   */
  assetDecimals?: number | null;
  assetSymbol?: string | null;
  /** Collapse behind a chevron header (default closed). */
  collapsible?: boolean;
  defaultOpen?: boolean;
}


export function VaultHolders({
  vaultAddress,
  chainId,
  limit = 500,
  pageSize = 10,
  assetDecimals,
  assetSymbol,
  collapsible = false,
  defaultOpen = false,
}: VaultHoldersProps) {
  const [open, setOpen] = useState(defaultOpen);
  const fetchEnabled = !collapsible || open;
  const { data, isLoading, error } = useVaultHolders(vaultAddress, limit, {
    enabled: fetchEnabled,
  });
  const scanUrl = getScanUrlForChain(chainId);

  const holders = useMemo(() => {
    const list = data?.holders ?? [];
    return [...list].sort((a, b) => (b.assetsUsd ?? 0) - (a.assetsUsd ?? 0));
  }, [data?.holders]);
  const totalHolders = data?.totalHolders ?? holders.length;
  const decimals = data?.asset.decimals ?? assetDecimals ?? 18;
  const symbol = data?.asset.symbol ?? assetSymbol ?? '';
  const displayDecimals = getTokenDisplayDecimals(symbol, decimals);

  const [page, setPage] = useState(0);

  useEffect(() => {
    setPage(0);
  }, [vaultAddress]);

  const totalPages = Math.max(1, Math.ceil(holders.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const pagedHolders = useMemo(
    () => holders.slice(safePage * pageSize, safePage * pageSize + pageSize),
    [holders, safePage, pageSize]
  );

  const titleMeta = (
    <Badge variant="secondary" className="text-xs font-normal">
      {!fetchEnabled
        ? `${pageSize} / page`
        : isLoading
          ? '…'
          : `${formatNumber(totalHolders)} total`}
    </Badge>
  );

  const body = !fetchEnabled ? null : isLoading ? (
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
      {/* Mobile: stacked cards */}
      <div className="space-y-2 sm:hidden">
        {pagedHolders.map((h, i) => {
          const rank = safePage * pageSize + i + 1;
          return (
            <div
              key={h.address}
              className="flex items-start justify-between gap-3 rounded-xl border border-border px-3 py-2.5"
            >
              <div className="min-w-0 space-y-0.5">
                <p className="text-[10px] text-muted-foreground">#{rank}</p>
                <DepositorAddress
                  address={h.address}
                  href={`${scanUrl}/address/${h.address}`}
                  startChars={6}
                  endChars={4}
                  className="break-all"
                />
              </div>
              <div className="shrink-0 text-right">
                <p className="font-mono text-xs tabular-nums">
                  {h.assets
                    ? formatRawTokenAmount(h.assets, decimals, displayDecimals)
                    : '—'}
                  {symbol ? ` ${symbol}` : ''}
                </p>
                <p className="mt-0.5 font-mono text-[11px] text-muted-foreground tabular-nums">
                  {h.assetsUsd != null ? formatFullUSD(h.assetsUsd) : '—'}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Desktop: table */}
      <div className="hidden sm:block">
        <CuratorTableShell>
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
                    <DepositorAddress
                      address={h.address}
                      href={`${scanUrl}/address/${h.address}`}
                      startChars={8}
                      endChars={6}
                    />
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {h.assets
                      ? formatRawTokenAmount(h.assets, decimals, displayDecimals)
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
                      className="text-muted-foreground hover:text-foreground"
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
        </CuratorTableShell>
      </div>

      <PaginationBar
        page={safePage}
        totalPages={totalPages}
        total={holders.length}
        pageSize={pageSize}
        onPage={setPage}
      />
    </>
  );

  if (collapsible) {
    return (
      <CollapsibleCard
        title={
          <>
            <Users className="h-4 w-4" />
            Top Holders
          </>
        }
        titleMeta={titleMeta}
        defaultOpen={defaultOpen}
        onOpenChange={setOpen}
      >
        {body}
      </CollapsibleCard>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Top Holders
          </CardTitle>
          <div className="flex items-center gap-2">{titleMeta}</div>
        </div>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}
