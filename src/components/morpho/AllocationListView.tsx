'use client';

import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { CapUtilizationRing } from '@/components/morpho/CapUtilizationRing';
import { CuratorTableShell } from '@/components/morpho/CuratorChrome';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { formatLtv } from '@/lib/format/number';
import {
  allocationHeaderSortDir,
  type AllocationFilterState,
  type AllocationHeaderSortColumn,
  type AllocationSortKey,
} from '@/lib/allocation/allocation-filters';

export function formatLltvPill(lltv: string | number | null | undefined): string | null {
  const formatted = formatLtv(lltv);
  if (formatted === '—') return null;
  const parsed = parseFloat(formatted);
  if (!Number.isFinite(parsed)) return null;
  return `${parsed.toFixed(2)}%`;
}

export function AllocationPill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex shrink-0 items-center rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">
      {children}
    </span>
  );
}

export function formatMarketPairLabel(
  collateral: string | null | undefined,
  loan: string | null | undefined
): string {
  if (collateral && loan) return `${collateral} / ${loan}`;
  return collateral || loan || 'Market';
}

interface AllocationListShellProps {
  children: ReactNode;
  className?: string;
}

function AllocationListShell({ children, className }: AllocationListShellProps) {
  return <CuratorTableShell className={cn('overflow-x-auto', className)}>{children}</CuratorTableShell>;
}

/** Morpho Curator–style optional allocation columns. */
const CURATOR_OPTIONAL_COLUMNS: {
  filterKey: keyof AllocationFilterState['columns'];
  label: string;
  sortColumn: AllocationHeaderSortColumn;
}[] = [
  { filterKey: 'utilization', label: 'Util.', sortColumn: 'utilization' },
  { filterKey: 'liquidity', label: 'Liquidity', sortColumn: 'liquidity' },
  { filterKey: 'effectiveCap', label: 'Eff. Abs. Cap', sortColumn: 'effectiveCap' },
  { filterKey: 'supplyApy', label: 'Rate', sortColumn: 'supplyApy' },
  { filterKey: 'borrowApy', label: 'Borrow', sortColumn: 'borrowApy' },
  { filterKey: 'allocated', label: 'Allocated', sortColumn: 'allocated' },
  { filterKey: 'percentCap', label: '% Cap', sortColumn: 'percentCap' },
];

export function getCuratorVisibleColumns(columns: AllocationFilterState['columns']) {
  return CURATOR_OPTIONAL_COLUMNS.filter((c) => columns[c.filterKey]);
}

const DEFAULT_CURATOR_COLUMNS: AllocationFilterState['columns'] = {
  utilization: true,
  liquidity: true,
  borrowApy: false,
  supplyApy: true,
  allocated: false,
  effectiveCap: true,
  percentCap: false,
};

function SortableAllocationHead({
  label,
  column,
  sort,
  align = 'right',
  onSortColumn,
}: {
  label: string;
  column: AllocationHeaderSortColumn;
  sort: AllocationSortKey;
  align?: 'left' | 'right';
  onSortColumn: (column: AllocationHeaderSortColumn) => void;
}) {
  const dir = allocationHeaderSortDir(sort, column);
  const Icon = dir == null ? ArrowUpDown : dir === 'asc' ? ArrowUp : ArrowDown;
  const nextHint =
    column === 'name'
      ? dir == null
        ? 'Z to A'
        : dir === 'desc'
          ? 'A to Z'
          : 'default order'
      : dir == null
        ? 'high to low'
        : dir === 'desc'
          ? 'low to high'
          : 'default order';

  return (
    <TableHead
      className={align === 'right' ? 'text-right' : undefined}
      aria-sort={dir == null ? 'none' : dir === 'asc' ? 'ascending' : 'descending'}
    >
      <button
        type="button"
        onClick={() => onSortColumn(column)}
        title={`Sort by ${label}: ${nextHint}`}
        className={cn(
          'inline-flex items-center gap-1 whitespace-nowrap font-medium transition-colors hover:text-foreground',
          align === 'right' && 'ml-auto',
          dir != null && 'text-foreground'
        )}
      >
        {label}
        <Icon className={cn('h-3.5 w-3.5 shrink-0', dir != null ? 'opacity-100' : 'opacity-40')} />
      </button>
    </TableHead>
  );
}

export function CuratorAllocationListHeader({
  editing = false,
  columns = DEFAULT_CURATOR_COLUMNS,
  sort = 'default',
  onSortColumn,
}: {
  editing?: boolean;
  columns?: AllocationFilterState['columns'];
  sort?: AllocationSortKey;
  onSortColumn?: (column: AllocationHeaderSortColumn) => void;
}) {
  const visible = getCuratorVisibleColumns(columns);
  const sortable = typeof onSortColumn === 'function';

  return (
    <TableHeader>
      <TableRow className="hover:bg-transparent">
        {sortable ? (
          <SortableAllocationHead
            label="Name"
            column="name"
            sort={sort}
            align="left"
            onSortColumn={onSortColumn}
          />
        ) : (
          <TableHead>Name</TableHead>
        )}
        {visible.map((col) =>
          sortable ? (
            <SortableAllocationHead
              key={col.filterKey}
              label={col.label}
              column={col.sortColumn}
              sort={sort}
              onSortColumn={onSortColumn}
            />
          ) : (
            <TableHead key={col.filterKey} className="text-right">
              {col.label}
            </TableHead>
          )
        )}
        {sortable ? (
          <SortableAllocationHead
            label="Allocation"
            column="allocated"
            sort={sort}
            onSortColumn={onSortColumn}
          />
        ) : (
          <TableHead className="text-right">Allocation</TableHead>
        )}
        {sortable ? (
          <SortableAllocationHead
            label="% Alloc."
            column="percentAlloc"
            sort={sort}
            onSortColumn={onSortColumn}
          />
        ) : (
          <TableHead className="text-right">% Alloc.</TableHead>
        )}
        {editing ? <TableHead className="text-right">Target</TableHead> : null}
      </TableRow>
    </TableHeader>
  );
}

export function AllocationPctIndicator({ pct }: { pct: number }) {
  return (
    <span className="inline-flex items-center justify-end gap-1.5">
      <CapUtilizationRing percent={pct} />
      <span className="tabular-nums text-foreground">{pct.toFixed(2)}%</span>
    </span>
  );
}

interface CuratorAllocationListRowProps {
  name: ReactNode;
  tags?: ReactNode;
  allocationAmount: ReactNode;
  optionalCells: ReactNode[];
  percentAllocated: ReactNode;
  targetCell?: ReactNode;
  className?: string;
  editing?: boolean;
  columns?: AllocationFilterState['columns'];
}

export function CuratorAllocationListRow({
  name,
  tags,
  allocationAmount,
  optionalCells,
  percentAllocated,
  targetCell,
  className,
  editing = false,
  columns = DEFAULT_CURATOR_COLUMNS,
}: CuratorAllocationListRowProps) {
  const visible = getCuratorVisibleColumns(columns);

  return (
    <TableRow className={className}>
      <TableCell>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="font-medium text-foreground">{name}</span>
          {tags}
        </div>
      </TableCell>
      {visible.map((col, i) => (
        <TableCell
          key={col.filterKey}
          className={cn(
            'text-right tabular-nums',
            col.filterKey === 'liquidity' && 'whitespace-normal'
          )}
        >
          {optionalCells[i] ?? '—'}
        </TableCell>
      ))}
      <TableCell className="text-right tabular-nums">{allocationAmount}</TableCell>
      <TableCell className="text-right">{percentAllocated}</TableCell>
      {editing ? <TableCell className="text-right">{targetCell}</TableCell> : null}
    </TableRow>
  );
}

export function AllocationTable({
  header,
  children,
}: {
  header: ReactNode;
  children: ReactNode;
}) {
  return (
    <AllocationListShell>
      <Table>
        {header}
        <TableBody>{children}</TableBody>
      </Table>
    </AllocationListShell>
  );
}
