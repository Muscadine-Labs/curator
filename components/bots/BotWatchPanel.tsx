'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Bot,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ExternalLink,
  RefreshCw,
  ShieldAlert,
  Wallet,
} from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
import { useBotActivity, type BotActivityPanel } from '@/lib/hooks/useBotActivity';
import {
  MUSCADINE_BOTS_GITHUB_URL,
  MUSCADINE_VAULT_BOT_TELEGRAM_URL,
} from '@/lib/constants';
import {
  formatAddress,
  formatRawTokenAmount,
  formatRelativeTime,
} from '@/lib/format/number';
import { getTokenDisplayDecimals } from '@/lib/format/asset-decimals';
import { getScanUrlForChain, BASE_CHAIN_ID } from '@/lib/constants';
import { CuratorTableShell } from '@/components/morpho/CuratorChrome';
import type {
  BotActivityItem,
  BotWatcher,
  RebaterActivityItem,
  RebaterWatcher,
} from '@/app/api/bots/activity/route';

const PAGE_SIZE = 10;

function prettyType(type: string): string {
  return type
    .replace(/^VaultV2/, '')
    .replace(/^Vault/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2');
}

function formatApy(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${value.toFixed(2)}%`;
}

function formatDeltaPp(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(3)} pp`;
}

function deltaClass(value: number | null): string {
  if (value == null) return 'text-muted-foreground';
  if (value > 0.001) return 'text-emerald-700 dark:text-emerald-400';
  if (value < -0.001) return 'text-rose-700 dark:text-rose-400';
  return 'text-muted-foreground';
}

function actorBadgeClass(kind: BotActivityItem['actorKind']): string {
  if (kind === 'allocator_safe' || kind === 'sentinel_safe') {
    return 'border-sky-500/30 bg-sky-500/10 text-sky-800 dark:text-sky-300';
  }
  if (kind === 'public_allocator') {
    return 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300';
  }
  return '';
}

function WatcherList({
  watchers,
  enabled,
  onToggle,
  scanUrl,
}: {
  watchers: BotWatcher[];
  enabled: Set<string>;
  onToggle: (address: string) => void;
  scanUrl: string;
}) {
  if (watchers.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {watchers.map((w) => {
        const key = w.address.toLowerCase();
        const isOn = enabled.has(key);
        return (
          <div
            key={w.address}
            className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] transition-opacity ${
              isOn
                ? 'border-border/60 bg-muted/40'
                : 'border-border/40 bg-muted/20 opacity-45'
            }`}
          >
            <button
              type="button"
              onClick={() => onToggle(w.address)}
              aria-pressed={isOn}
              title={isOn ? `Hide activity from ${w.label}` : `Show activity from ${w.label}`}
              className="inline-flex items-center gap-1 touch-manipulation rounded px-0.5 py-0.5 hover:bg-muted/70"
            >
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${
                  isOn ? 'bg-emerald-500' : 'bg-muted-foreground/40'
                }`}
                aria-hidden
              />
              <Badge
                variant="outline"
                className={`h-4 border-0 px-1 text-[9px] ${actorBadgeClass(w.kind)}`}
              >
                {w.label}
              </Badge>
              <span className="font-mono text-muted-foreground">
                {formatAddress(w.address, 4, 4)}
              </span>
            </button>
            <a
              href={`${scanUrl}/address/${w.address}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted/70 hover:text-foreground"
              aria-label={`Open ${w.label} on explorer`}
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        );
      })}
    </div>
  );
}

function ActivityRow({ item }: { item: BotActivityItem }) {
  const [open, setOpen] = useState(false);
  const scanUrl = getScanUrlForChain(BASE_CHAIN_ID);
  const displayDecimals = getTokenDisplayDecimals(
    item.assetSymbol,
    item.assetDecimals
  );

  return (
    <div className="border-b border-border/60 last:border-0">
      <div className="flex items-start gap-2 px-1 py-3 sm:gap-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={open ? 'Collapse activity' : 'Expand activity'}
          className="mt-0.5 inline-flex h-9 w-9 shrink-0 touch-manipulation items-center justify-center rounded-md text-muted-foreground hover:bg-muted/60 sm:h-7 sm:w-7"
        >
          {open ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </button>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="min-w-0 flex-1 space-y-1.5 text-left touch-manipulation"
        >
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className={`text-[10px] ${actorBadgeClass(item.actorKind)}`}
            >
              {item.actorLabel}
            </Badge>
            <span className="text-sm font-medium">{item.vaultName}</span>
            <span className="text-xs text-muted-foreground">
              {item.timestamp
                ? formatRelativeTime(new Date(item.timestamp * 1000))
                : '—'}
            </span>
          </div>

          {item.liquidityMarketLabel && (
            <p className="text-xs">
              <span className="text-muted-foreground">Liquidity adapter → </span>
              <span className="font-medium">{item.liquidityMarketLabel}</span>
            </p>
          )}

          <div className="grid gap-2 text-xs sm:grid-cols-3">
            <div>
              <p className="text-muted-foreground">APY change</p>
              <p className={`font-medium tabular-nums ${deltaClass(item.apyDeltaPp)}`}>
                {formatApy(item.apyBefore)} → {formatApy(item.apyAfter)}{' '}
                <span className="text-muted-foreground">
                  ({formatDeltaPp(item.apyDeltaPp)})
                </span>
              </p>
            </div>
            <div className="sm:col-span-2">
              <p className="text-muted-foreground">Risk</p>
              <p className="font-medium">{item.riskNote}</p>
            </div>
          </div>
        </button>
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-1 pb-2 pl-11 text-[11px]">
        <Link
          href={`/vault/${item.vaultAddress}`}
          className="text-blue-600 hover:underline dark:text-blue-400"
        >
          Open vault
        </Link>
        <a
          href={`${scanUrl}/tx/${item.hash}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-mono text-blue-600 hover:underline dark:text-blue-400"
        >
          {formatAddress(item.hash, 8, 6)}
          <ExternalLink className="h-3 w-3" />
        </a>
        <a
          href={`${scanUrl}/address/${item.from}`}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-muted-foreground hover:underline"
        >
          from {formatAddress(item.from, 4, 4)}
        </a>
      </div>

      {open && (
        <div className="space-y-2 pb-3 pl-2 sm:pl-11">
          <p className="text-xs font-medium text-muted-foreground">
            What changed ({item.changes.length} leg
            {item.changes.length === 1 ? '' : 's'})
          </p>
          <div className="space-y-2 sm:hidden">
            {item.changes.map((c, idx) => {
              const raw = c.change ?? c.assets;
              const isLiq = c.type.toLowerCase().includes('liquidity');
              const isCap = c.type.toLowerCase().includes('cap');
              const showAmount = !isLiq && (raw != null || isCap);
              return (
                <div
                  key={`${item.hash}-${idx}`}
                  className="rounded-md border border-border/60 px-3 py-2 text-xs"
                >
                  <Badge variant="outline" className="text-xs">
                    {prettyType(c.type)}
                  </Badge>
                  <p className="mt-1 font-mono text-[10px] text-muted-foreground break-all">
                    {c.marketLabel ??
                      (isLiq
                        ? c.marketId
                          ? formatAddress(c.marketId, 10, 8)
                          : '—'
                        : c.allocationId
                          ? formatAddress(c.allocationId, 10, 8)
                          : c.adapterAddress
                            ? formatAddress(c.adapterAddress, 8, 6)
                            : '—')}
                  </p>
                  {!showAmount ? null : (
                    <p className="mt-1 text-right font-mono tabular-nums">
                      {isCap && c.change
                        ? c.change
                        : raw
                          ? `${formatRawTokenAmount(raw, item.assetDecimals, displayDecimals)} ${item.assetSymbol}`
                          : '—'}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
          <div className="hidden sm:block">
            <CuratorTableShell>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Action</TableHead>
                  <TableHead>Market / id</TableHead>
                  <TableHead className="text-right">Delta</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {item.changes.map((c, idx) => {
                  const raw = c.change ?? c.assets;
                  const isLiq = c.type.toLowerCase().includes('liquidity');
                  const isCap = c.type.toLowerCase().includes('cap');
                  const showAmount = !isLiq && (raw != null || isCap);
                  return (
                    <TableRow key={`${item.hash}-${idx}`}>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {prettyType(c.type)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">
                        {c.marketLabel ? (
                          <span className="font-medium">{c.marketLabel}</span>
                        ) : isLiq ? (
                          <span className="font-medium">
                            {c.marketId
                              ? formatAddress(c.marketId, 10, 8)
                              : 'Liquidity market'}
                          </span>
                        ) : (
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {c.allocationId
                              ? formatAddress(c.allocationId, 10, 8)
                              : c.adapterAddress
                                ? formatAddress(c.adapterAddress, 8, 6)
                                : '—'}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {!showAmount
                          ? '—'
                          : isCap && c.change
                            ? c.change
                            : raw
                              ? `${formatRawTokenAmount(raw, item.assetDecimals, displayDecimals)} ${item.assetSymbol}`
                              : '—'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            </CuratorTableShell>
          </div>
        </div>
      )}
    </div>
  );
}

function RoleActivityCard({
  title,
  description,
  emptyMessage,
  icon: Icon,
  watchers,
  enabledAddresses,
  onToggleAddress,
  items,
  isLoading,
  error,
  collapsed,
  onToggleCollapsed,
  collapsible = true,
}: {
  title: string;
  description: string;
  emptyMessage: string;
  icon: typeof Bot;
  watchers: BotWatcher[];
  enabledAddresses: Set<string>;
  onToggleAddress: (address: string) => void;
  items: BotActivityItem[];
  isLoading: boolean;
  error: Error | null;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  collapsible?: boolean;
}) {
  const [page, setPage] = useState(0);
  const scanUrl = getScanUrlForChain(BASE_CHAIN_ID);
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const paged = useMemo(
    () => items.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE),
    [items, safePage]
  );

  useEffect(() => {
    setPage(0);
  }, [items]);

  return (
    <Card className="min-w-0">
      <CardHeader className="space-y-3">
        {collapsible ? (
        <button
          type="button"
          onClick={onToggleCollapsed}
          className="flex w-full items-start justify-between gap-3 text-left touch-manipulation"
          aria-expanded={!collapsed}
        >
          <div className="min-w-0 flex-1">
            <CardTitle className="flex flex-wrap items-center gap-2 text-sm font-semibold">
              <Icon className="h-4 w-4 shrink-0" />
              <span>{title}</span>
              {!isLoading && (
                <Badge variant="secondary" className="text-[10px] tabular-nums">
                  {items.length}
                </Badge>
              )}
            </CardTitle>
            {!collapsed && (
              <p className="mt-1 text-xs text-muted-foreground">{description}</p>
            )}
          </div>
          <span
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/60 sm:h-8 sm:w-8"
            aria-hidden
          >
            {collapsed ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronUp className="h-4 w-4" />
            )}
          </span>
        </button>
        ) : (
          <div>
            <CardTitle className="flex flex-wrap items-center gap-2 text-sm font-semibold">
              <Icon className="h-4 w-4 shrink-0" />
              <span>{title}</span>
              {!isLoading && (
                <Badge variant="secondary" className="text-[10px] tabular-nums">
                  {items.length}
                </Badge>
              )}
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">{description}</p>
          </div>
        )}
        {!collapsed && (
          <div className="space-y-1.5">
            <p className="text-[10px] text-muted-foreground">
              Tap an address to include / exclude it from the feed.
            </p>
            <WatcherList
              watchers={watchers}
              enabled={enabledAddresses}
              onToggle={onToggleAddress}
              scanUrl={scanUrl}
            />
          </div>
        )}
      </CardHeader>
      {!collapsed && (
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : error ? (
            <p className="text-sm text-red-600 dark:text-red-400">
              Failed to load: {error.message}
            </p>
          ) : paged.length === 0 ? (
            <p className="text-sm text-muted-foreground">{emptyMessage}</p>
          ) : (
            <>
              <CuratorTableShell>
                <div className="divide-y divide-border">
                {paged.map((item) => (
                  <ActivityRow key={`${item.hash}-${item.panel}`} item={item} />
                ))}
                </div>
              </CuratorTableShell>
              {items.length > PAGE_SIZE && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span className="min-w-0">
                    Showing {safePage * PAGE_SIZE + 1}–
                    {Math.min(items.length, (safePage + 1) * PAGE_SIZE)} of{' '}
                    {items.length}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-9 w-9 touch-manipulation p-0 sm:h-7 sm:w-7"
                      disabled={safePage === 0}
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </Button>
                    <span className="min-w-[3.5rem] text-center tabular-nums">
                      {safePage + 1} / {totalPages}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-9 w-9 touch-manipulation p-0 sm:h-7 sm:w-7"
                      disabled={safePage >= totalPages - 1}
                      onClick={() =>
                        setPage((p) => Math.min(totalPages - 1, p + 1))
                      }
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}

/** Role Safes on by default; other role holders stay off until toggled. */
function defaultWatcherOn(kind: BotWatcher['kind']): boolean {
  return kind === 'allocator_safe' || kind === 'sentinel_safe';
}

function useEnabledWatcherSet(watchers: BotWatcher[]) {
  const [overrides, setOverrides] = useState<Map<string, boolean>>(() => new Map());
  const watcherKey = watchers.map((w) => w.address.toLowerCase()).sort().join(',');

  useEffect(() => {
    const valid = new Set(watchers.map((w) => w.address.toLowerCase()));
    setOverrides((prev) => {
      let changed = false;
      const next = new Map<string, boolean>();
      for (const [k, v] of prev) {
        if (valid.has(k)) next.set(k, v);
        else changed = true;
      }
      return changed || next.size !== prev.size ? next : prev;
    });
  }, [watcherKey, watchers]);

  const enabled = useMemo(() => {
    const set = new Set<string>();
    for (const w of watchers) {
      const key = w.address.toLowerCase();
      const on = overrides.has(key) ? Boolean(overrides.get(key)) : defaultWatcherOn(w.kind);
      if (on) set.add(key);
    }
    return set;
  }, [watchers, overrides]);

  const toggle = (address: string) => {
    const key = address.toLowerCase();
    setOverrides((prev) => {
      const next = new Map(prev);
      const watcher = watchers.find((w) => w.address.toLowerCase() === key);
      const current = next.has(key)
        ? Boolean(next.get(key))
        : watcher
          ? defaultWatcherOn(watcher.kind)
          : false;
      next.set(key, !current);
      return next;
    });
  };

  return { enabled, toggle };
}

function RebaterCard({
  watchers,
  items,
  isLoading,
  error,
  truncated,
  fetchError,
}: {
  watchers: RebaterWatcher[];
  items: RebaterActivityItem[];
  isLoading: boolean;
  error: Error | null;
  truncated?: boolean;
  fetchError?: string | null;
}) {
  const [page, setPage] = useState(0);
  const scanUrl = getScanUrlForChain(BASE_CHAIN_ID);
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const paged = useMemo(
    () => items.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE),
    [items, safePage]
  );

  useEffect(() => {
    setPage(0);
  }, [items]);

  return (
    <Card className="min-w-0">
      <CardHeader className="space-y-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm font-semibold">
          <Wallet className="h-4 w-4 shrink-0" />
          <span>Rebater</span>
          {!isLoading && (
            <Badge variant="secondary" className="text-[10px] tabular-nums">
              {items.length}
            </Badge>
          )}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Funds leaving the treasury Safe (vault share transfers and withdrawals).
          The Rebater bot is not deployed yet — GraphQL rows appear when an outflow
          is indexed.
        </p>
        {(truncated || fetchError) && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            {fetchError
              ? `Could not load all treasury outflows: ${fetchError}`
              : 'Transfer history was truncated; older outflows may be missing.'}
          </p>
        )}
        <div className="flex flex-wrap gap-1.5">
          {watchers.map((w) => (
            <div
              key={w.address}
              className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[10px]"
            >
              <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" aria-hidden />
              <Badge variant="outline" className="h-4 border-0 px-1 text-[9px]">
                {w.label}
              </Badge>
              <span className="font-mono text-muted-foreground">
                {formatAddress(w.address, 4, 4)}
              </span>
              <a
                href={`${scanUrl}/address/${w.address}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                aria-label={`Open ${w.label} on explorer`}
              >
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : error ? (
          <p className="text-sm text-red-600 dark:text-red-400">
            Failed to load: {error.message}
          </p>
        ) : paged.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No treasury outflows indexed yet.
          </p>
        ) : (
          <>
            <CuratorTableShell>
              <div className="divide-y divide-border">
              {paged.map((item) => {
                const displayDecimals = getTokenDisplayDecimals(
                  item.assetSymbol,
                  item.assetDecimals
                );
                return (
                  <div key={item.hash} className="space-y-1 px-3 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="text-[10px]">
                        {item.type}
                      </Badge>
                      <span className="text-sm font-medium">{item.vaultName}</span>
                      <span className="text-xs text-muted-foreground">
                        {formatRelativeTime(new Date(item.timestamp * 1000))}
                      </span>
                    </div>
                    <p className="font-mono text-xs tabular-nums">
                      {item.assets
                        ? `${formatRawTokenAmount(item.assets, item.assetDecimals, displayDecimals)} ${item.assetSymbol}`
                        : `${item.shares} shares`}
                    </p>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
                      <Link
                        href={`/vault/${item.vaultAddress}`}
                        className="text-blue-600 hover:underline dark:text-blue-400"
                      >
                        Open vault
                      </Link>
                      <a
                        href={`${scanUrl}/tx/${item.hash}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 font-mono text-blue-600 hover:underline dark:text-blue-400"
                      >
                        {formatAddress(item.hash, 8, 6)}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                      {item.to ? (
                        <a
                          href={`${scanUrl}/address/${item.to}`}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-muted-foreground hover:underline"
                        >
                          to {formatAddress(item.to, 4, 4)}
                        </a>
                      ) : null}
                    </div>
                  </div>
                );
              })}
              </div>
            </CuratorTableShell>
            {items.length > PAGE_SIZE && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>
                  Showing {safePage * PAGE_SIZE + 1}–
                  {Math.min(items.length, (safePage + 1) * PAGE_SIZE)} of {items.length}
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-9 w-9 p-0 sm:h-7 sm:w-7"
                    disabled={safePage === 0}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </Button>
                  <span className="min-w-[3.5rem] text-center tabular-nums">
                    {safePage + 1} / {totalPages}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-9 w-9 p-0 sm:h-7 sm:w-7"
                    disabled={safePage >= totalPages - 1}
                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
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

export function BotWatchPanel() {
  const [tab, setTab] = useState<BotActivityPanel>('allocator');
  const { data, isLoading, error, refetch, isFetching } = useBotActivity({ panel: tab });
  const [vaultFilter, setVaultFilter] = useState<string>('all');

  const vaults = useMemo(() => data?.vaults ?? [], [data?.vaults]);
  const allocators = useMemo(() => data?.allocators ?? [], [data?.allocators]);
  const sentinels = useMemo(() => data?.sentinels ?? [], [data?.sentinels]);

  const allocatorWatch = useEnabledWatcherSet(allocators);
  const sentinelWatch = useEnabledWatcherSet(sentinels);

  const allocatorItems = useMemo(() => {
    let items = data?.allocatorItems ?? [];
    if (vaultFilter !== 'all') {
      const needle = vaultFilter.toLowerCase();
      items = items.filter((i) => i.vaultAddress.toLowerCase() === needle);
    }
    return items.filter((i) => allocatorWatch.enabled.has(i.from.toLowerCase()));
  }, [data?.allocatorItems, vaultFilter, allocatorWatch.enabled]);

  const sentinelItems = useMemo(() => {
    let items = data?.sentinelItems ?? [];
    if (vaultFilter !== 'all') {
      const needle = vaultFilter.toLowerCase();
      items = items.filter((i) => i.vaultAddress.toLowerCase() === needle);
    }
    return items.filter((i) => sentinelWatch.enabled.has(i.from.toLowerCase()));
  }, [data?.sentinelItems, vaultFilter, sentinelWatch.enabled]);

  const rebaterItems = useMemo(() => {
    let items = data?.rebaterItems ?? [];
    if (vaultFilter !== 'all') {
      const needle = vaultFilter.toLowerCase();
      items = items.filter((i) => i.vaultAddress.toLowerCase() === needle);
    }
    return items;
  }, [data?.rebaterItems, vaultFilter]);

  const err = error instanceof Error ? error : error ? new Error(String(error)) : null;

  const emptyFor = (role: 'allocator' | 'sentinel') => {
    const enabled =
      role === 'allocator' ? allocatorWatch.enabled : sentinelWatch.enabled;
    if (enabled.size === 0) {
      return 'All addresses are toggled off — turn one on to see activity.';
    }
    if (vaultFilter !== 'all') {
      return role === 'allocator'
        ? 'No allocator activity for this vault from the selected addresses.'
        : 'No sentinel activity for this vault from the selected addresses.';
    }
    return role === 'allocator'
      ? 'No recent allocator activity (allocate, rebalance, or liquidity adapter changes).'
      : 'No recent sentinel activity (deallocate, cap decrease, revoke pending, or remove allocator).';
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <a
          href={MUSCADINE_VAULT_BOT_TELEGRAM_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-blue-600 hover:underline dark:text-blue-400"
        >
          Telegram @MuscadineVaultBot
          <ExternalLink className="h-3 w-3" />
        </a>
        <a
          href={MUSCADINE_BOTS_GITHUB_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-muted-foreground hover:underline"
          title="Muscadine fork — downstream changes"
        >
          muscadine-bots
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as BotActivityPanel)}
      >
        <TabsList className="w-full sm:w-fit">
          <TabsTrigger value="allocator">Allocator</TabsTrigger>
          <TabsTrigger value="sentinel">Sentinel</TabsTrigger>
          <TabsTrigger value="rebater">Rebater</TabsTrigger>
        </TabsList>

        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
          <p className="text-xs text-muted-foreground max-w-2xl">
            Allocate / deallocate and roles come from Morpho GraphQL. Liquidity
            adapter, cap decreases, revoke pending, and remove-allocator are decoded
            from calldata when GraphQL has no row.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">Vault</span>
              <select
                value={vaultFilter}
                onChange={(e) => setVaultFilter(e.target.value)}
                className="h-9 min-w-[12rem] max-w-full rounded-md border border-input bg-background px-2 text-sm touch-manipulation sm:h-8 sm:text-xs"
              >
                <option value="all">All vaults</option>
                {vaults.map((v) => (
                  <option key={v.address} value={v.address}>
                    {v.name}
                  </option>
                ))}
              </select>
            </label>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-9 touch-manipulation sm:h-8"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </div>

        <TabsContent value="allocator">
          <RoleActivityCard
            title="Allocator"
            description="Allocate, rebalance (alloc+dealloc), and liquidity-adapter market changes."
            emptyMessage={emptyFor('allocator')}
            icon={Bot}
            watchers={allocators}
            enabledAddresses={allocatorWatch.enabled}
            onToggleAddress={allocatorWatch.toggle}
            items={allocatorItems}
            isLoading={isLoading}
            error={err}
            collapsed={false}
            onToggleCollapsed={() => undefined}
            collapsible={false}
          />
        </TabsContent>
        <TabsContent value="sentinel">
          <RoleActivityCard
            title="Sentinel"
            description="Deallocate-only, decrease absolute/relative caps, revoke pending, and remove allocator. Never allocate."
            emptyMessage={emptyFor('sentinel')}
            icon={ShieldAlert}
            watchers={sentinels}
            enabledAddresses={sentinelWatch.enabled}
            onToggleAddress={sentinelWatch.toggle}
            items={sentinelItems}
            isLoading={isLoading}
            error={err}
            collapsed={false}
            onToggleCollapsed={() => undefined}
            collapsible={false}
          />
        </TabsContent>
        <TabsContent value="rebater">
          <RebaterCard
            watchers={data?.rebaterWatchers ?? []}
            items={rebaterItems}
            isLoading={isLoading}
            error={err}
            truncated={data?.rebaterTruncated}
            fetchError={data?.rebaterError}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
