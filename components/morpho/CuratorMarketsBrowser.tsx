'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ArrowDown, ArrowUp, ArrowUpDown, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { useCuratorMarkets, useMidnightMarkets } from '@/lib/hooks/useCuratorMarkets';
import type { CuratorMarketListItem } from '@/lib/morpho/curator-markets';
import type { MidnightMarketListItem } from '@/lib/morpho/midnight-markets';
import { formatCompactUSD, formatPercentage } from '@/lib/format/number';
import { formatMarketTokenAmount } from '@/components/morpho/TokenUsdValue';
import { formatLltvPill } from '@/components/morpho/AllocationListView';
import { curatorBlueMarketHref, curatorMidnightMarketHref } from '@/lib/morpho/morpho-app-links';
import { marketMatchesPairFilters } from '@/lib/morpho/market-pair-filter';
import { useCuratorNetwork } from '@/lib/network/CuratorNetworkContext';
import { cn } from '@/lib/utils';
import { CuratorTableShell } from '@/components/morpho/CuratorChrome';

type ListedFilter = 'all' | 'listed' | 'unlisted';
type MuscadineFilter = 'all' | 'muscadine';
export type MarketsProductFilter = 'all' | 'blue' | 'midnight';

const PRODUCT_HREF: Record<MarketsProductFilter, string> = {
  all: '/markets',
  blue: '/markets/blue',
  midnight: '/markets/midnight',
};
type BrowserFilters = {
  search: string;
  loan: string;
  collateral: string;
  listed: ListedFilter;
  muscadine: MuscadineFilter;
};

function filtersFromQuery(query: string): BrowserFilters {
  const params = new URLSearchParams(query);
  const listed = params.get('listed');
  return {
    search: params.get('q') ?? '',
    loan: params.get('loan') ?? '',
    collateral: params.get('collateral') ?? '',
    listed: listed === 'all' || listed === 'unlisted' || listed === 'listed' ? listed : 'listed',
    muscadine: params.get('muscadine') === 'muscadine' ? 'muscadine' : 'all',
  };
}

function filtersToQuery(filters: BrowserFilters): string {
  const params = new URLSearchParams();
  if (filters.search.trim()) params.set('q', filters.search.trim());
  if (filters.loan.trim()) params.set('loan', filters.loan.trim());
  if (filters.collateral.trim()) params.set('collateral', filters.collateral.trim());
  if (filters.listed !== 'listed') params.set('listed', filters.listed);
  if (filters.muscadine !== 'all') params.set('muscadine', filters.muscadine);
  return params.toString();
}

type SortKey = 'pair' | 'lltv' | 'sizeUsd' | 'liquidity' | 'apy' | 'listed' | 'muscadine';
type SortDir = 'asc' | 'desc';

const SORTABLE_COLUMNS: { key: SortKey; label: string; align?: 'right' }[] = [
  { key: 'pair', label: 'Collateral / Loan' },
  { key: 'lltv', label: 'LLTV' },
  { key: 'sizeUsd', label: 'Market size', align: 'right' },
  { key: 'liquidity', label: 'Liquidity', align: 'right' },
  { key: 'apy', label: '6H net APY', align: 'right' },
  { key: 'listed', label: 'Listed' },
  { key: 'muscadine', label: 'Muscadine' },
];

function compareMarkets(a: CuratorMarketListItem, b: CuratorMarketListItem, key: SortKey): number {
  switch (key) {
    case 'pair': {
      const left = `${a.collateralSymbol}/${a.loanSymbol}`.toLowerCase();
      const right = `${b.collateralSymbol}/${b.loanSymbol}`.toLowerCase();
      return left.localeCompare(right);
    }
    case 'lltv':
      return Number(a.lltv ?? 0) - Number(b.lltv ?? 0);
    case 'sizeUsd':
      return (a.sizeUsd ?? 0) - (b.sizeUsd ?? 0);
    case 'liquidity':
      return (a.liquidityAssetsUsd ?? 0) - (b.liquidityAssetsUsd ?? 0);
    case 'apy':
      return (a.avgNetSupplyApy ?? 0) - (b.avgNetSupplyApy ?? 0);
    case 'listed':
      return Number(a.listed) - Number(b.listed);
    case 'muscadine':
      return a.muscadineVaults.length - b.muscadineVaults.length;
    default:
      return 0;
  }
}

function SortableHead({
  label,
  sortKey,
  activeKey,
  sortDir,
  align,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  sortDir: SortDir;
  align?: 'right';
  onSort: (key: SortKey) => void;
}) {
  const active = activeKey === sortKey;
  const Icon = active ? (sortDir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;

  return (
    <TableHead className={align === 'right' ? 'text-right' : undefined}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onSort(sortKey);
        }}
        className={cn(
          'inline-flex items-center gap-1 whitespace-nowrap font-medium transition-colors hover:text-foreground',
          align === 'right' && 'ml-auto',
          active && 'text-foreground'
        )}
      >
        {label}
        <Icon className={cn('h-3.5 w-3.5 shrink-0', active ? 'opacity-100' : 'opacity-40')} />
      </button>
    </TableHead>
  );
}

function MetricCell({ primary, secondary }: { primary: ReactNode; secondary?: ReactNode }) {
  return (
    <div className="text-right tabular-nums">
      <div className="font-medium">{primary}</div>
      {secondary != null && (
        <div className="text-xs font-normal text-muted-foreground">{secondary}</div>
      )}
    </div>
  );
}

function MidnightMarketsTable({
  markets,
  loading,
  networkName,
  filtered,
  onOpen,
}: {
  markets: MidnightMarketListItem[];
  loading: boolean;
  networkName: string;
  filtered: boolean;
  onOpen: (market: MidnightMarketListItem) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Midnight is Morpho&apos;s fixed-term (tenor) book. GraphQL is Blue-only;
        this table uses the Morpho REST books API. Maturity is the market tenor
        date; remaining tenor is time-to-maturity.
      </p>
      <CuratorTableShell>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Network</TableHead>
              <TableHead>Loan</TableHead>
              <TableHead>Collateral</TableHead>
              <TableHead>LLTV</TableHead>
              <TableHead>Maturity / tenor</TableHead>
              <TableHead className="text-right">Lend depth</TableHead>
              <TableHead className="text-right">Borrow depth</TableHead>
              <TableHead className="text-right">Best rate</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading &&
              [...Array(6)].map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={8}>
                    <Skeleton className="h-8 w-full" />
                  </TableCell>
                </TableRow>
              ))}
            {!loading && markets.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                  {filtered
                    ? 'No Midnight markets match your filters.'
                    : `No Midnight markets on ${networkName}.`}
                </TableCell>
              </TableRow>
            )}
            {!loading &&
              markets.map((market) => {
                const maturity = new Date(market.maturity * 1000).toLocaleDateString(
                  undefined,
                  { month: 'short', day: 'numeric', year: 'numeric' }
                );
                return (
                  <TableRow
                    key={market.marketId}
                    tabIndex={0}
                    role="link"
                    onClick={() => onOpen(market)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onOpen(market);
                      }
                    }}
                    className="cursor-pointer"
                  >
                    <TableCell className="text-xs">{networkName}</TableCell>
                    <TableCell className="font-medium">{market.loanSymbol}</TableCell>
                    <TableCell className="text-sm">{market.collateralLabel}</TableCell>
                    <TableCell className="text-xs">{market.lltvLabel}</TableCell>
                    <TableCell>
                      <div>
                        <div className="text-sm">{maturity}</div>
                        <div className="text-xs text-muted-foreground">{market.tenorLabel}</div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <MetricCell
                        primary={
                          formatMarketTokenAmount(
                            market.lendDepthAssets,
                            market.loanSymbol,
                            market.loanDecimals
                          ) ?? '—'
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <MetricCell
                        primary={
                          formatMarketTokenAmount(
                            market.borrowDepthAssets,
                            market.loanSymbol,
                            market.loanDecimals
                          ) ?? '—'
                        }
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      {market.bestRate != null
                        ? formatPercentage(market.bestRate * 100)
                        : '—'}
                    </TableCell>
                  </TableRow>
                );
              })}
          </TableBody>
        </Table>
      </CuratorTableShell>
    </div>
  );
}

export function CuratorMarketsBrowser({
  product = 'all',
}: {
  product?: MarketsProductFilter;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { chainId, networkName, ready } = useCuratorNetwork();
  const initialFilters = filtersFromQuery(searchParams.toString());
  const [search, setSearch] = useState(initialFilters.search);
  const [loanFilter, setLoanFilter] = useState(initialFilters.loan);
  const [collateralFilter, setCollateralFilter] = useState(initialFilters.collateral);
  const [listedFilter, setListedFilter] = useState<ListedFilter>(initialFilters.listed);
  const [muscadineFilter, setMuscadineFilter] = useState<MuscadineFilter>(
    initialFilters.muscadine
  );
  const productFilter = product;
  const [sortKey, setSortKey] = useState<SortKey>('sizeUsd');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // Two-way URL sync. `lastSyncedQuery` is the query we last read or wrote, so
  // our own writes are not read back as navigation, while a real navigation
  // (sidebar "Markets", Back) resets the filters instead of being overwritten.
  const urlQuery = searchParams.toString();
  const lastSyncedQuery = useRef(urlQuery);

  useEffect(() => {
    if (urlQuery === lastSyncedQuery.current) return;
    lastSyncedQuery.current = urlQuery;
    const next = filtersFromQuery(urlQuery);
    setSearch(next.search);
    setLoanFilter(next.loan);
    setCollateralFilter(next.collateral);
    setListedFilter(next.listed);
    setMuscadineFilter(next.muscadine);
  }, [urlQuery]);

  useEffect(() => {
    const next = filtersToQuery({
      search,
      loan: loanFilter,
      collateral: collateralFilter,
      listed: listedFilter,
      muscadine: muscadineFilter,
    });
    if (next === lastSyncedQuery.current) return;
    lastSyncedQuery.current = next;
    // Native replaceState syncs useSearchParams without an RSC round trip per keystroke.
    window.history.replaceState(null, '', next ? `${pathname}?${next}` : pathname);
  }, [search, loanFilter, collateralFilter, listedFilter, muscadineFilter, pathname]);

  const { data, isLoading, error, refetch } = useCuratorMarkets(chainId, {
    enabled: ready && productFilter !== 'midnight',
  });
  const {
    data: midnightData,
    isLoading: midnightLoading,
    error: midnightError,
    refetch: refetchMidnight,
  } = useMidnightMarkets(chainId, {
    enabled: ready && productFilter !== 'blue',
  });
  const loading = !ready || (productFilter !== 'midnight' && isLoading);
  const midnightBusy = !ready || (productFilter !== 'blue' && midnightLoading);

  const resetFilters = () => {
    setSearch('');
    setLoanFilter('');
    setCollateralFilter('');
    setListedFilter('listed');
    setMuscadineFilter('all');
    setSortKey('sizeUsd');
    setSortDir('desc');
    void refetch();
    void refetchMidnight();
  };

  const pairFilters = useMemo(
    () => ({ search, loanFilter, collateralFilter }),
    [search, loanFilter, collateralFilter]
  );
  const pairFiltersActive =
    search.trim().length > 0 ||
    loanFilter.trim().length > 0 ||
    collateralFilter.trim().length > 0;

  const filtered = useMemo(() => {
    const markets = data?.markets ?? [];

    return markets.filter((m) => {
      if (listedFilter === 'listed' && !m.listed) return false;
      if (listedFilter === 'unlisted' && m.listed) return false;
      if (muscadineFilter === 'muscadine' && m.muscadineVaults.length === 0) return false;
      return marketMatchesPairFilters(
        {
          loanSymbol: m.loanSymbol,
          collateralSymbols: [m.collateralSymbol],
          marketId: m.marketId,
        },
        pairFilters
      );
    });
  }, [data?.markets, pairFilters, listedFilter, muscadineFilter]);

  const filteredMidnight = useMemo(() => {
    const markets = midnightData?.markets ?? [];
    return markets.filter((m) =>
      marketMatchesPairFilters(
        {
          loanSymbol: m.loanSymbol,
          collateralSymbols: m.collaterals.map((c) => c.symbol),
          marketId: m.marketId,
        },
        pairFilters
      )
    );
  }, [midnightData?.markets, pairFilters]);

  const sorted = useMemo(() => {
    const list = [...filtered];
    list.sort((a, b) => {
      const cmp = compareMarkets(a, b, sortKey);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [filtered, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setSortDir(key === 'pair' || key === 'listed' ? 'asc' : 'desc');
  };

  const returnTo = `${pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ''}`;

  const openMarket = (market: CuratorMarketListItem) => {
    const href = curatorBlueMarketHref(market.marketId, market.chainId, returnTo);
    if (href) router.push(href);
  };

  const openMidnight = (market: MidnightMarketListItem) => {
    const href = curatorMidnightMarketHref(market.marketId, market.chainId, returnTo);
    if (href) router.push(href);
  };

  const showBlue = productFilter === 'all' || productFilter === 'blue';
  const showMidnight = productFilter === 'all' || productFilter === 'midnight';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Product</label>
          <select
            value={productFilter}
            onChange={(e) => {
              const next = e.target.value as MarketsProductFilter;
              router.push(PRODUCT_HREF[next]);
            }}
            className="h-9 rounded-md border border-border bg-background px-3 text-sm"
          >
            <option value="all">All</option>
            <option value="blue">Blue — variable rate</option>
            <option value="midnight">Midnight — fixed rate</option>
          </select>
        </div>
        <div className="min-w-[140px] flex-1 space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Loan</label>
          <Input
            placeholder="e.g. USDC"
            value={loanFilter}
            onChange={(e) => setLoanFilter(e.target.value)}
          />
        </div>

        <div className="min-w-[140px] flex-1 space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Collateral</label>
          <Input
            placeholder="e.g. WETH"
            value={collateralFilter}
            onChange={(e) => setCollateralFilter(e.target.value)}
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Listed</label>
          <select
            value={listedFilter}
            onChange={(e) => setListedFilter(e.target.value as ListedFilter)}
            className="h-9 rounded-md border border-border bg-background px-3 text-sm"
          >
            <option value="all">All</option>
            <option value="listed">Listed</option>
            <option value="unlisted">Not listed</option>
          </select>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Muscadine</label>
          <select
            value={muscadineFilter}
            onChange={(e) => setMuscadineFilter(e.target.value as MuscadineFilter)}
            className="h-9 rounded-md border border-border bg-background px-3 text-sm"
          >
            <option value="all">All markets</option>
            <option value="muscadine">Enabled caps only</option>
          </select>
        </div>

        <div className="min-w-[200px] flex-[2] space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Search</label>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="cbBTC/USDC, loan, or market id"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      </div>

      {showBlue && (
        <p className="text-xs text-muted-foreground">
          Network follows the Account → Network toggle ({networkName}). Sorted by{' '}
          {SORTABLE_COLUMNS.find((c) => c.key === sortKey)?.label.toLowerCase() ?? 'market size'}{' '}
          ({sortDir === 'desc' ? 'high → low' : 'low → high'}). Tap a column header to re-sort.
          Rows highlighted in blue have a Muscadine vault market cap enabled.
        </p>
      )}

      {showBlue && error && (
        <p className="text-sm text-red-600 dark:text-red-400">
          {error instanceof Error ? error.message : 'Failed to load markets'}
        </p>
      )}

      {showBlue && (
        <CuratorTableShell className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                {SORTABLE_COLUMNS.map((col) => (
                  <SortableHead
                    key={col.key}
                    label={col.label}
                    sortKey={col.key}
                    activeKey={sortKey}
                    sortDir={sortDir}
                    align={col.align}
                    onSort={toggleSort}
                  />
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading &&
                [...Array(8)].map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={7}>
                      <Skeleton className="h-8 w-full" />
                    </TableCell>
                  </TableRow>
                ))}

              {!loading && sorted.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                    No markets match your filters.
                  </TableCell>
                </TableRow>
              )}

              {!loading &&
                sorted.map((market) => {
                  const muscadine = market.muscadineVaults.length > 0;
                  const sizeToken =
                    formatMarketTokenAmount(
                      market.supplyAssets,
                      market.loanSymbol,
                      market.loanDecimals
                    ) ?? '—';
                  const liqToken =
                    formatMarketTokenAmount(
                      market.liquidityAssets,
                      market.loanSymbol,
                      market.loanDecimals
                    ) ?? '—';
                  return (
                    <TableRow
                      key={market.marketId}
                      tabIndex={0}
                      role="link"
                      onClick={() => openMarket(market)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          openMarket(market);
                        }
                      }}
                      className={cn(
                        'cursor-pointer',
                        muscadine &&
                          'bg-blue-50/80 hover:bg-blue-100/80 dark:bg-blue-950/30 dark:hover:bg-blue-950/50'
                      )}
                    >
                      <TableCell className="font-medium">
                        {market.collateralSymbol} / {market.loanSymbol}
                      </TableCell>
                      <TableCell>{formatLltvPill(market.lltv) ?? '—'}</TableCell>
                      <TableCell>
                        <MetricCell
                          primary={sizeToken}
                          secondary={
                            market.sizeUsd != null
                              ? formatCompactUSD(market.sizeUsd)
                              : undefined
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <MetricCell
                          primary={liqToken}
                          secondary={
                            market.liquidityAssetsUsd != null
                              ? formatCompactUSD(market.liquidityAssetsUsd)
                              : undefined
                          }
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        {market.avgNetSupplyApy != null
                          ? formatPercentage(market.avgNetSupplyApy * 100)
                          : '—'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={market.listed ? 'default' : 'secondary'}>
                          {market.listed ? 'Listed' : 'No'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {muscadine ? (
                          <span className="text-xs text-blue-700 dark:text-blue-300">
                            {market.muscadineVaults.map((v) => v.symbol).join(', ')}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
            </TableBody>
          </Table>
        </CuratorTableShell>
      )}

      {showBlue && !loading && (
        <p className="text-xs text-muted-foreground">
          Showing {sorted.length} of {data?.markets.length ?? 0} Blue markets on {networkName}.
          Tap a row for risk details or{' '}
          <button
            type="button"
            className="underline underline-offset-2"
            onClick={resetFilters}
          >
            reset filters
          </button>
          .
        </p>
      )}

      {showMidnight && (
        <div className="space-y-2">
          {productFilter === 'all' ? (
            <h3 className="text-sm font-semibold">Midnight</h3>
          ) : null}
          {midnightError ? (
            <p className="text-sm text-red-600 dark:text-red-400">
              {midnightError instanceof Error
                ? midnightError.message
                : 'Failed to load Midnight markets'}
            </p>
          ) : null}
          <MidnightMarketsTable
            markets={filteredMidnight}
            loading={midnightBusy}
            networkName={networkName}
            filtered={pairFiltersActive}
            onOpen={openMidnight}
          />
          {!midnightBusy && (
            <p className="text-xs text-muted-foreground">
              Showing {filteredMidnight.length} of {midnightData?.markets.length ?? 0}{' '}
              Midnight markets on {networkName}
              {pairFiltersActive ? ' (same Loan / Collateral / Search as Blue)' : ''}.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
