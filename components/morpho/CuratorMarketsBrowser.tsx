'use client';

import { useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
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
import { useCuratorMarkets } from '@/lib/hooks/useCuratorMarkets';
import type { CuratorMarketListItem } from '@/lib/morpho/curator-markets';
import {
  BASE_CHAIN_ID,
  CURATOR_MARKET_NETWORKS,
} from '@/lib/constants';
import {
  formatCompactUSD,
  formatPercentage,
} from '@/lib/format/number';
import { formatLltvPill } from '@/components/morpho/AllocationListView';
import { cn } from '@/lib/utils';

type ListedFilter = 'all' | 'listed' | 'unlisted';
type MuscadineFilter = 'all' | 'muscadine';
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
      return (a.totalLiquidityUsd ?? 0) - (b.totalLiquidityUsd ?? 0);
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
          'inline-flex items-center gap-1 whitespace-nowrap font-medium transition-colors hover:text-slate-900 dark:hover:text-slate-100',
          align === 'right' && 'ml-auto',
          active && 'text-slate-900 dark:text-slate-100'
        )}
      >
        {label}
        <Icon className={cn('h-3.5 w-3.5 shrink-0', active ? 'opacity-100' : 'opacity-40')} />
      </button>
    </TableHead>
  );
}

function formatMorphoTokenAmount(usd: number | null, symbol: string): string {
  if (usd == null || usd === 0) return `0 ${symbol}`;
  const compact = new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 2,
  }).format(usd);
  return `${compact} ${symbol}`;
}

function MetricCell({ primary, secondary }: { primary: ReactNode; secondary?: ReactNode }) {
  return (
    <div className="text-right tabular-nums">
      <div>{primary}</div>
      {secondary != null && (
        <div className="text-xs text-slate-500 dark:text-slate-400">{secondary}</div>
      )}
    </div>
  );
}

export function CuratorMarketsBrowser() {
  const router = useRouter();
  const [chainId, setChainId] = useState(BASE_CHAIN_ID);
  const [search, setSearch] = useState('');
  const [loanFilter, setLoanFilter] = useState('');
  const [collateralFilter, setCollateralFilter] = useState('');
  const [listedFilter, setListedFilter] = useState<ListedFilter>('listed');
  const [muscadineFilter, setMuscadineFilter] = useState<MuscadineFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('sizeUsd');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const { data, isLoading, error } = useCuratorMarkets(chainId);

  const filtered = useMemo(() => {
    const markets = data?.markets ?? [];
    const q = search.trim().toLowerCase();
    const loanQ = loanFilter.trim().toLowerCase();
    const colQ = collateralFilter.trim().toLowerCase();

    return markets.filter((m) => {
      if (loanQ && !m.loanSymbol.toLowerCase().includes(loanQ)) return false;
      if (colQ && !m.collateralSymbol.toLowerCase().includes(colQ)) return false;
      if (listedFilter === 'listed' && !m.listed) return false;
      if (listedFilter === 'unlisted' && m.listed) return false;
      if (muscadineFilter === 'muscadine' && m.muscadineVaults.length === 0) return false;
      if (!q) return true;
      const haystack =
        `${m.collateralSymbol} ${m.loanSymbol} ${m.marketId}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [data?.markets, search, loanFilter, collateralFilter, listedFilter, muscadineFilter]);

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

  const openMarket = (market: CuratorMarketListItem) => {
    router.push(
      `/curator/market/blue/${encodeURIComponent(market.marketId)}?chainId=${market.chainId}`
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Network</label>
          <select
            value={chainId}
            onChange={(e) => setChainId(Number(e.target.value))}
            className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900"
          >
            {CURATOR_MARKET_NETWORKS.map((n) => (
              <option key={n.chainId} value={n.chainId}>
                {n.name}
              </option>
            ))}
          </select>
        </div>

        <div className="min-w-[140px] flex-1 space-y-1">
          <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Loan</label>
          <Input
            placeholder="e.g. USDC"
            value={loanFilter}
            onChange={(e) => setLoanFilter(e.target.value)}
          />
        </div>

        <div className="min-w-[140px] flex-1 space-y-1">
          <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Collateral</label>
          <Input
            placeholder="e.g. WETH"
            value={collateralFilter}
            onChange={(e) => setCollateralFilter(e.target.value)}
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Listed</label>
          <select
            value={listedFilter}
            onChange={(e) => setListedFilter(e.target.value as ListedFilter)}
            className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900"
          >
            <option value="all">All</option>
            <option value="listed">Listed</option>
            <option value="unlisted">Not listed</option>
          </select>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Muscadine</label>
          <select
            value={muscadineFilter}
            onChange={(e) => setMuscadineFilter(e.target.value as MuscadineFilter)}
            className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900"
          >
            <option value="all">All markets</option>
            <option value="muscadine">Enabled caps only</option>
          </select>
        </div>

        <div className="min-w-[200px] flex-[2] space-y-1">
          <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Search</label>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <Input
              className="pl-9"
              placeholder="Pair or market id"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      </div>

      <p className="text-xs text-slate-500 dark:text-slate-400">
        Wallet network in the top bar is for on-chain writes only. Market data uses the network
        filter above. Sorted by{' '}
        {SORTABLE_COLUMNS.find((c) => c.key === sortKey)?.label.toLowerCase() ?? 'market size'}{' '}
        ({sortDir === 'desc' ? 'high → low' : 'low → high'}). Tap a column header to re-sort.
        Rows highlighted in blue have a Muscadine vault market cap enabled.
      </p>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">
          {error instanceof Error ? error.message : 'Failed to load markets'}
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
        <Table>
          <TableHeader>
            <TableRow>
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
            {isLoading &&
              [...Array(8)].map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={7}>
                    <Skeleton className="h-8 w-full" />
                  </TableCell>
                </TableRow>
              ))}

            {!isLoading && sorted.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-sm text-slate-500">
                  No markets match your filters.
                </TableCell>
              </TableRow>
            )}

            {!isLoading &&
              sorted.map((market) => {
                const muscadine = market.muscadineVaults.length > 0;
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
                        primary={formatMorphoTokenAmount(market.sizeUsd, market.loanSymbol)}
                        secondary={formatCompactUSD(market.sizeUsd ?? 0)}
                      />
                    </TableCell>
                    <TableCell>
                      <MetricCell
                        primary={formatMorphoTokenAmount(
                          market.totalLiquidityUsd,
                          market.loanSymbol
                        )}
                        secondary={formatCompactUSD(market.totalLiquidityUsd ?? 0)}
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
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
          </TableBody>
        </Table>
      </div>

      {!isLoading && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Showing {sorted.length} of {data?.markets.length ?? 0} markets on{' '}
          {CURATOR_MARKET_NETWORKS.find((n) => n.chainId === chainId)?.name ?? 'network'}.
          Tap a row for risk details or{' '}
          <Link href="/curator/markets" className="underline">
            refresh filters
          </Link>
          .
        </p>
      )}
    </div>
  );
}
