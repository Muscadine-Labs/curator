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
import { isMidnightMarketActive } from '@/lib/morpho/midnight-format';
import { formatCompactUSD, formatPercentage } from '@/lib/format/number';
import { formatMarketTokenAmount } from '@/components/morpho/TokenUsdValue';
import { formatLltvPill } from '@/components/morpho/AllocationListView';
import { curatorBlueMarketHref, curatorMidnightMarketHref } from '@/lib/morpho/morpho-app-links';
import { marketMatchesPairFilters } from '@/lib/morpho/market-pair-filter';
import {
  blueBrowseRow,
  compareBrowseRows,
  midnightBrowseRow,
  type BrowseSortDir,
  type BrowseSortKey,
  type MarketsBrowseRow,
} from '@/lib/morpho/markets-browse-rows';
import { useCuratorNetwork } from '@/lib/network/CuratorNetworkContext';
import { cn } from '@/lib/utils';
import { CuratorTableShell } from '@/components/morpho/CuratorChrome';

type ListedFilter = 'all' | 'listed' | 'unlisted';
type MuscadineFilter = 'all' | 'muscadine';
type MidnightStatusFilter = 'active' | 'matured' | 'all';
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
  midnightStatus: MidnightStatusFilter;
};

function midnightStatusFromQuery(value: string | null): MidnightStatusFilter {
  if (value === 'matured' || value === 'all' || value === 'active') return value;
  return 'active';
}

function filtersFromQuery(query: string): BrowserFilters {
  const params = new URLSearchParams(query);
  const listed = params.get('listed');
  return {
    search: params.get('q') ?? '',
    loan: params.get('loan') ?? '',
    collateral: params.get('collateral') ?? '',
    listed: listed === 'all' || listed === 'unlisted' || listed === 'listed' ? listed : 'listed',
    muscadine: params.get('muscadine') === 'muscadine' ? 'muscadine' : 'all',
    midnightStatus: midnightStatusFromQuery(params.get('maturity')),
  };
}

function filtersToQuery(filters: BrowserFilters): string {
  const params = new URLSearchParams();
  if (filters.search.trim()) params.set('q', filters.search.trim());
  if (filters.loan.trim()) params.set('loan', filters.loan.trim());
  if (filters.collateral.trim()) params.set('collateral', filters.collateral.trim());
  if (filters.listed !== 'listed') params.set('listed', filters.listed);
  if (filters.muscadine !== 'all') params.set('muscadine', filters.muscadine);
  if (filters.midnightStatus !== 'active') params.set('maturity', filters.midnightStatus);
  return params.toString();
}

type SortDir = BrowseSortDir;

const BROWSE_COLUMNS: {
  key: BrowseSortKey;
  label: string;
  align?: 'right';
  products: Array<'blue' | 'midnight'>;
}[] = [
  { key: 'pair', label: 'Collateral / Loan', products: ['blue', 'midnight'] },
  { key: 'lltv', label: 'LLTV', products: ['blue', 'midnight'] },
  { key: 'sizeUsd', label: 'Market size', align: 'right', products: ['blue', 'midnight'] },
  { key: 'liquidity', label: 'Liquidity', align: 'right', products: ['blue'] },
  { key: 'apy', label: '6H net APY', align: 'right', products: ['blue'] },
  { key: 'maturity', label: 'Maturity', products: ['midnight'] },
  { key: 'listed', label: 'Listed', products: ['blue'] },
  { key: 'muscadine', label: 'Muscadine', products: ['blue'] },
];

function columnsFor(product: MarketsProductFilter) {
  if (product === 'all') return BROWSE_COLUMNS;
  return BROWSE_COLUMNS.filter((column) => column.products.includes(product));
}

function SortableHead<K extends string>({
  label,
  sortKey,
  activeKey,
  sortDir,
  align,
  onSort,
}: {
  label: string;
  sortKey: K;
  activeKey: K;
  sortDir: BrowseSortDir;
  align?: 'right';
  onSort: (key: K) => void;
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

function BlankCell() {
  return <span className="text-muted-foreground">—</span>;
}

function maturityLabel(maturitySec: number): string {
  return new Date(maturitySec * 1000).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function BrowseCell({
  column,
  row,
  showProduct,
}: {
  column: BrowseSortKey;
  row: MarketsBrowseRow;
  showProduct: boolean;
}) {
  const blue = row.blue;
  const midnight = row.midnight;

  switch (column) {
    case 'pair':
      return (
        <TableCell className="font-medium">
          <div className="flex items-center gap-2">
            <span>
              {blue
                ? `${blue.collateralSymbol} / ${blue.loanSymbol}`
                : `${midnight?.collateralLabel} / ${midnight?.loanSymbol}`}
            </span>
            {showProduct ? (
              <Badge
                className={
                  row.product === 'blue'
                    ? 'border-transparent bg-blue-600 text-white hover:bg-blue-600'
                    : 'border-transparent bg-black text-white hover:bg-black'
                }
              >
                {row.product === 'blue' ? 'Blue' : 'Midnight'}
              </Badge>
            ) : null}
          </div>
        </TableCell>
      );
    case 'lltv':
      return (
        <TableCell className={midnight ? 'text-xs' : undefined}>
          {blue ? (formatLltvPill(blue.lltv) ?? '—') : (midnight?.lltvLabel ?? '—')}
        </TableCell>
      );
    case 'sizeUsd': {
      const sizeToken = blue
        ? (formatMarketTokenAmount(blue.supplyAssets, blue.loanSymbol, blue.loanDecimals) ?? '—')
        : midnight
          ? (formatMarketTokenAmount(
              midnight.sizeAssets,
              midnight.loanSymbol,
              midnight.loanDecimals
            ) ?? '—')
          : '—';
      return (
        <TableCell>
          <MetricCell
            primary={sizeToken}
            secondary={row.sizeUsd != null ? formatCompactUSD(row.sizeUsd) : undefined}
          />
        </TableCell>
      );
    }
    case 'liquidity': {
      if (!blue) {
        return (
          <TableCell>
            <div className="text-right">
              <BlankCell />
            </div>
          </TableCell>
        );
      }
      const liqToken =
        formatMarketTokenAmount(blue.liquidityAssets, blue.loanSymbol, blue.loanDecimals) ?? '—';
      return (
        <TableCell>
          <MetricCell
            primary={liqToken}
            secondary={
              blue.liquidityAssetsUsd != null ? formatCompactUSD(blue.liquidityAssetsUsd) : undefined
            }
          />
        </TableCell>
      );
    }
    case 'apy':
      return (
        <TableCell className="text-right">
          {row.apy != null ? formatPercentage(row.apy * 100) : <BlankCell />}
        </TableCell>
      );
    case 'maturity':
      return (
        <TableCell>
          {midnight && row.maturity != null ? (
            <div>
              <div className="text-sm">{maturityLabel(row.maturity)}</div>
              <div className="text-xs text-muted-foreground">{midnight.tenorLabel}</div>
            </div>
          ) : (
            <BlankCell />
          )}
        </TableCell>
      );
    case 'listed':
      return (
        <TableCell>
          {blue ? (
            <Badge variant={blue.listed ? 'default' : 'secondary'}>
              {blue.listed ? 'Listed' : 'No'}
            </Badge>
          ) : (
            <BlankCell />
          )}
        </TableCell>
      );
    case 'muscadine':
      return (
        <TableCell>
          {blue && blue.muscadineVaults.length > 0 ? (
            <span className="text-xs text-blue-700 dark:text-blue-300">
              {blue.muscadineVaults.map((vault) => vault.symbol).join(', ')}
            </span>
          ) : (
            <BlankCell />
          )}
        </TableCell>
      );
    default:
      return <TableCell />;
  }
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
  const [midnightStatus, setMidnightStatus] = useState<MidnightStatusFilter>(
    initialFilters.midnightStatus
  );
  const productFilter = product;
  const [sortKey, setSortKey] = useState<BrowseSortKey>('sizeUsd');
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
    setMidnightStatus(next.midnightStatus);
  }, [urlQuery]);

  useEffect(() => {
    const next = filtersToQuery({
      search,
      loan: loanFilter,
      collateral: collateralFilter,
      listed: listedFilter,
      muscadine: muscadineFilter,
      midnightStatus,
    });
    if (next === lastSyncedQuery.current) return;
    lastSyncedQuery.current = next;
    // replaceState does not update useSearchParams, so market links read filter state.
    window.history.replaceState(null, '', next ? `${pathname}?${next}` : pathname);
  }, [
    search,
    loanFilter,
    collateralFilter,
    listedFilter,
    muscadineFilter,
    midnightStatus,
    pathname,
  ]);

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
    setMidnightStatus('active');
    setSortKey('sizeUsd');
    setSortDir('desc');
    void refetch();
    void refetchMidnight();
  };

  const pairFilters = useMemo(
    () => ({ search, loanFilter, collateralFilter }),
    [search, loanFilter, collateralFilter]
  );

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
    const nowSec = Math.floor(Date.now() / 1000);
    return markets.filter((m) => {
      const active = isMidnightMarketActive(m.maturity, nowSec);
      if (midnightStatus === 'active' && !active) return false;
      if (midnightStatus === 'matured' && active) return false;
      return marketMatchesPairFilters(
        {
          loanSymbol: m.loanSymbol,
          collateralSymbols: m.collaterals.map((c) => c.symbol),
          marketId: m.marketId,
        },
        pairFilters
      );
    });
  }, [midnightData?.markets, pairFilters, midnightStatus]);

  const showBlue = productFilter === 'all' || productFilter === 'blue';
  const showMidnight = productFilter === 'all' || productFilter === 'midnight';
  const columns = columnsFor(productFilter);
  const tableLoading =
    (showBlue && loading && !error) || (showMidnight && midnightBusy && !midnightError);

  const sorted = useMemo(() => {
    const rows: MarketsBrowseRow[] = [];
    if (showBlue) rows.push(...filtered.map(blueBrowseRow));
    if (showMidnight) rows.push(...filteredMidnight.map(midnightBrowseRow));
    rows.sort((a, b) => compareBrowseRows(a, b, sortKey, sortDir));
    return rows;
  }, [filtered, filteredMidnight, showBlue, showMidnight, sortKey, sortDir]);

  const toggleSort = (key: BrowseSortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setSortDir(key === 'pair' || key === 'listed' ? 'asc' : 'desc');
  };

  const filters: BrowserFilters = {
    search,
    loan: loanFilter,
    collateral: collateralFilter,
    listed: listedFilter,
    muscadine: muscadineFilter,
    midnightStatus,
  };
  const filterQuery = filtersToQuery(filters);
  const returnTo = filterQuery ? `${pathname}?${filterQuery}` : pathname;

  const openRow = (row: MarketsBrowseRow) => {
    const href = row.blue
      ? curatorBlueMarketHref(row.blue.marketId, row.blue.chainId, returnTo)
      : row.midnight
        ? curatorMidnightMarketHref(row.midnight.marketId, row.midnight.chainId, returnTo)
        : null;
    if (href) router.push(href);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Product</label>
          <select
            value={productFilter}
            onChange={(e) => {
              const next = e.target.value as MarketsProductFilter;
              const href = PRODUCT_HREF[next];
              router.push(filterQuery ? `${href}?${filterQuery}` : href);
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

        {showMidnight && (
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Midnight</label>
            <select
              value={midnightStatus}
              onChange={(e) => setMidnightStatus(e.target.value as MidnightStatusFilter)}
              className="h-9 rounded-md border border-border bg-background px-3 text-sm"
            >
              <option value="active">Active</option>
              <option value="matured">Matured</option>
              <option value="all">All</option>
            </select>
          </div>
        )}

        {showBlue && (
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
        )}

        {showBlue && (
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
        )}

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

      <p className="text-xs text-muted-foreground">
        Sorted by{' '}
        {BROWSE_COLUMNS.find((column) => column.key === sortKey)?.label.toLowerCase() ??
          'market size'}{' '}
        ({sortDir === 'desc' ? 'high → low' : 'low → high'}). Tap a column header to re-sort.
        {productFilter === 'all'
          ? ' Blue and Midnight share one table. A blank cell means that column does not apply. Listed and Muscadine filter Blue rows only.'
          : ''}{' '}
        {showBlue ? ' Rows highlighted in blue have a Muscadine vault market cap enabled.' : ''}
      </p>

      {showBlue && error ? (
        <p className="text-sm text-red-600 dark:text-red-400">
          {error instanceof Error ? error.message : 'Failed to load markets'}
        </p>
      ) : null}
      {showMidnight && midnightError ? (
        <p className="text-sm text-red-600 dark:text-red-400">
          {midnightError instanceof Error
            ? midnightError.message
            : 'Failed to load Midnight markets'}
        </p>
      ) : null}

      <CuratorTableShell className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {columns.map((col) => (
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
            {tableLoading &&
              [...Array(8)].map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={columns.length}>
                    <Skeleton className="h-8 w-full" />
                  </TableCell>
                </TableRow>
              ))}

            {!tableLoading && sorted.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="py-8 text-center text-sm text-muted-foreground"
                >
                  No markets match your filters.
                </TableCell>
              </TableRow>
            )}

            {!tableLoading &&
              sorted.map((row) => {
                const muscadine = (row.blue?.muscadineVaults.length ?? 0) > 0;
                return (
                  <TableRow
                    key={row.id}
                    tabIndex={0}
                    role="link"
                    onClick={() => openRow(row)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        openRow(row);
                      }
                    }}
                    className={cn(
                      'cursor-pointer',
                      row.product === 'midnight' &&
                        'bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-900 dark:hover:bg-neutral-800',
                      muscadine &&
                        'bg-blue-100 hover:bg-blue-200 dark:bg-blue-950/50 dark:hover:bg-blue-950/70'
                    )}
                  >
                    {columns.map((column) => (
                      <BrowseCell
                        key={column.key}
                        column={column.key}
                        row={row}
                        showProduct={productFilter === 'all'}
                      />
                    ))}
                  </TableRow>
                );
              })}
          </TableBody>
        </Table>
      </CuratorTableShell>

      {!tableLoading && (
        <p className="text-xs text-muted-foreground">
          Showing {sorted.length} markets on {networkName}
          {showBlue ? ` · ${sorted.filter((row) => row.product === 'blue').length} Blue` : ''}
          {showMidnight
            ? ` · ${sorted.filter((row) => row.product === 'midnight').length} Midnight${
                midnightStatus === 'active'
                  ? ' active'
                  : midnightStatus === 'matured'
                    ? ' matured'
                    : ''
              }`
            : ''}
          . Tap a row to open it or{' '}
          <button type="button" className="underline underline-offset-2" onClick={resetFilters}>
            reset filters
          </button>
          .
        </p>
      )}
    </div>
  );
}
