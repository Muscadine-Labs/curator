'use client';

import { useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  ExternalLink,
  ShieldAlert,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useVaultSentinelHistory } from '@/lib/hooks/useVaultSentinelHistory';
import { formatRelativeTime, formatAddress } from '@/lib/format/number';
import { getScanUrlForChain } from '@/lib/constants';
import type {
  SentinelActivityEvent,
  SentinelActivityGroup,
} from '@/lib/morpho/v2-sentinel-history';

interface SentinelHistoryProps {
  vaultAddress: string;
  chainId: number;
  assetDecimals?: number | null;
  assetSymbol?: string | null;
  pageSize?: number;
}

function eventTypeLabel(type: SentinelActivityEvent['type']): string {
  switch (type) {
    case 'Deallocate':
      return 'Deallocate';
    case 'DecreaseAbsoluteCap':
      return 'Decrease absolute cap';
    case 'DecreaseRelativeCap':
      return 'Decrease relative cap';
    default:
      return type;
  }
}

function eventTypeBadge(type: SentinelActivityEvent['type']) {
  if (type === 'Deallocate') {
    return (
      <Badge variant="outline" className="border-rose-500/30 text-rose-700 dark:text-rose-400 text-xs">
        Deallocate
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="border-amber-500/30 text-amber-700 dark:text-amber-400 text-xs">
      {eventTypeLabel(type)}
    </Badge>
  );
}

function groupHeading(group: SentinelActivityGroup): string {
  const types = new Set(group.events.map((e) => e.type));
  if (types.size === 1) {
    return eventTypeLabel(group.events[0]!.type);
  }
  return 'Sentinel actions';
}

function GroupRow({
  group,
  scanUrl,
}: {
  group: SentinelActivityGroup;
  scanUrl: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const timestampMs = group.timestamp * 1000;
  const heading = groupHeading(group);

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
            <ShieldAlert className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <span className="text-sm font-medium text-slate-900 dark:text-slate-100">{heading}</span>
            <Badge variant="secondary" className="text-xs shrink-0">
              {group.events.length} action{group.events.length !== 1 ? 's' : ''}
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
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>
      </button>
      {expanded && (
        <div className="border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/30">
          {group.events.map((ev, idx) => (
            <div
              key={`${ev.type}-${ev.capId ?? idx}-${idx}`}
              className="flex flex-wrap items-center gap-2 px-4 py-2.5 pl-11 text-sm"
            >
              {eventTypeBadge(ev.type)}
              <span className="text-slate-900 dark:text-slate-100 min-w-0 truncate">
                {ev.label ?? 'Unknown target'}
              </span>
              {ev.detail && (
                <span className="text-muted-foreground text-xs">→ {ev.detail}</span>
              )}
              {ev.adapterAddress && (
                <span className="text-xs text-muted-foreground">
                  {formatAddress(ev.adapterAddress)}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function SentinelHistory({
  vaultAddress,
  chainId,
  pageSize = 10,
}: SentinelHistoryProps) {
  const { data, isLoading, isError, refetch, isFetching } = useVaultSentinelHistory(vaultAddress, 100);
  const [page, setPage] = useState(1);

  const scanUrl = getScanUrlForChain(chainId);

  const groups = data?.groups ?? [];
  const totalPages = Math.max(1, Math.ceil(groups.length / pageSize));
  const safePage = Math.min(page, totalPages);

  const pageGroups = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return groups.slice(start, start + pageSize);
  }, [groups, safePage, pageSize]);

  const rangeStart = groups.length === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const rangeEnd = Math.min(safePage * pageSize, groups.length);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Sentinel Activity</CardTitle>
        <CardDescription>
          Deallocates from Morpho&apos;s index plus cap decreases from on-chain vault events (last ~1
          day).
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : isError ? (
          <div className="p-4 text-sm text-red-600 dark:text-red-400">
            Failed to load sentinel activity.{' '}
            <button type="button" className="underline" onClick={() => void refetch()}>
              Retry
            </button>
          </div>
        ) : groups.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            No deallocate or cap decrease transactions found in the last ~1 day.
          </p>
        ) : (
          <>
            <div>
              {pageGroups.map((group) => (
                <GroupRow key={group.hash} group={group} scanUrl={scanUrl} />
              ))}
            </div>
            <div className="flex items-center justify-between border-t border-slate-100 dark:border-slate-800 px-4 py-3">
              <span className="text-xs text-muted-foreground">
                Showing {rangeStart}–{rangeEnd} of {groups.length}
                {isFetching ? ' · refreshing…' : ''}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-7 w-7"
                  disabled={safePage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-7 w-7"
                  disabled={safePage >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
