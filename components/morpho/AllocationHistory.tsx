'use client';

import { useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  ExternalLink,
  RefreshCw,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useVaultReallocations } from '@/lib/hooks/useVaultReallocations';
import { formatRelativeTime, formatLtv, formatRawTokenAmount } from '@/lib/format/number';
import { getScanUrlForChain } from '@/lib/constants';
import type { ReallocationGroup, ReallocationEvent } from '@/app/api/vaults/[id]/reallocations/route';

interface AllocationHistoryProps {
  vaultAddress: string;
  chainId: number;
  assetDecimals?: number | null;
  assetSymbol?: string | null;
  pageSize?: number;
}

function prettyType(type: string): string {
  return type
    .replace(/^MetaMorpho/, '')
    .replace(/^VaultV2/, '')
    .replace(/^Vault/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2');
}

function eventTypeBadge(type: string) {
  const lower = type.toLowerCase();
  if (lower.includes('supply') || lower.includes('allocate')) {
    return (
      <Badge variant="outline" className="border-emerald-500/30 text-emerald-700 dark:text-emerald-400 text-xs">
        {prettyType(type)}
      </Badge>
    );
  }
  if (lower.includes('withdraw') || lower.includes('deallocate')) {
    return (
      <Badge variant="outline" className="border-rose-500/30 text-rose-700 dark:text-rose-400 text-xs">
        {prettyType(type)}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-muted-foreground text-xs">
      {prettyType(type)}
    </Badge>
  );
}

function GroupRow({
  group,
  scanUrl,
  assetDecimals,
  assetSymbol,
}: {
  group: ReallocationGroup;
  scanUrl: string;
  assetDecimals: number;
  assetSymbol: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const timestampMs = group.timestamp * 1000;

  return (
    <div className="border-b border-slate-100 dark:border-slate-800 last:border-0">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        )}
        <div className="flex flex-1 items-center justify-between gap-2 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <RefreshCw className="h-4 w-4 text-blue-500 shrink-0" />
            <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
              Reallocation
            </span>
            <Badge variant="secondary" className="text-xs shrink-0">
              {group.events.length} position{group.events.length !== 1 ? 's' : ''}
            </Badge>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span className="text-xs text-muted-foreground" title={new Date(timestampMs).toLocaleString()}>
              {formatRelativeTime(new Date(timestampMs))}
            </span>
            <a
              href={`${scanUrl}/tx/${group.hash}`}
              target="_blank"
              rel="noreferrer"
              className="text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
              onClick={(e) => e.stopPropagation()}
              aria-label="View transaction"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>
      </button>

      {expanded && (
        <div className="bg-slate-50/50 dark:bg-slate-800/30 px-4 pb-3">
          <div className="space-y-1 pl-7">
            {group.events.map((ev, i) => (
              <EventRow key={`${ev.hash}-${i}`} event={ev} assetDecimals={assetDecimals} assetSymbol={assetSymbol} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function EventRow({
  event,
  assetDecimals,
  assetSymbol,
}: {
  event: ReallocationEvent;
  assetDecimals: number;
  assetSymbol: string;
}) {
  const marketLabel = event.market
    ? `${event.market.collateralAssetSymbol ?? '?'} / ${event.market.loanAssetSymbol ?? '?'}`
    : null;
  const lltv = event.market?.lltv ? formatLtv(event.market.lltv) : null;

  return (
    <div className="flex items-center justify-between gap-2 rounded px-3 py-2 text-sm">
      <div className="flex items-center gap-2 min-w-0">
        {eventTypeBadge(event.type)}
        {marketLabel && (
          <span className="text-xs text-slate-600 dark:text-slate-400 truncate">
            {marketLabel}
            {lltv && <span className="ml-1 text-muted-foreground">({lltv} LLTV)</span>}
          </span>
        )}
      </div>
      {event.assets && (
        <span className="font-mono text-xs text-slate-700 dark:text-slate-300 shrink-0">
          {formatRawTokenAmount(event.assets, assetDecimals, assetDecimals >= 8 ? 4 : 2)} {assetSymbol}
        </span>
      )}
    </div>
  );
}

export function AllocationHistory({
  vaultAddress,
  chainId,
  assetDecimals,
  assetSymbol,
  pageSize = 10,
}: AllocationHistoryProps) {
  const { data, isLoading, error } = useVaultReallocations(vaultAddress, 200);
  const [page, setPage] = useState(0);
  const scanUrl = getScanUrlForChain(chainId);

  const groups = data?.groups ?? [];
  const totalPages = Math.max(1, Math.ceil(groups.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const paged = useMemo(
    () => groups.slice(safePage * pageSize, safePage * pageSize + pageSize),
    [groups, safePage, pageSize]
  );
  const rangeStart = groups.length === 0 ? 0 : safePage * pageSize + 1;
  const rangeEnd = Math.min(groups.length, (safePage + 1) * pageSize);
  const decimals = assetDecimals ?? 18;
  const symbol = assetSymbol ?? '';

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="flex items-center gap-2">
            Allocation History
            <Badge variant="secondary" className="text-xs">
              {isLoading ? '…' : `${groups.length} event${groups.length === 1 ? '' : 's'}`}
            </Badge>
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : error ? (
          <p className="text-sm text-red-600 dark:text-red-400">
            Failed to load allocation history: {error instanceof Error ? error.message : 'Unknown error'}
          </p>
        ) : groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">No reallocation events found.</p>
        ) : (
          <>
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
              {paged.map((group) => (
                <GroupRow
                  key={group.hash}
                  group={group}
                  scanUrl={scanUrl}
                  assetDecimals={decimals}
                  assetSymbol={symbol}
                />
              ))}
            </div>

            {groups.length > pageSize && (
              <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  Showing {rangeStart}–{rangeEnd} of {groups.length}
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
