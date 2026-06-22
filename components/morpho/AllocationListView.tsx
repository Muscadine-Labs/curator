'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { formatLtv, formatRawTokenAmount } from '@/lib/format/number';
import { getTokenDisplayDecimals } from '@/lib/format/asset-decimals';
import type { AllocationFilterState } from '@/components/morpho/AllocationFilters';

export const EXTRA_COLUMN_META: {
  key: keyof AllocationFilterState['columns'];
  label: string;
}[] = [
  { key: 'utilization', label: 'Util.' },
  { key: 'liquidity', label: 'Liquidity' },
  { key: 'borrowApy', label: 'Borrow' },
  { key: 'supplyApy', label: 'Supply' },
  { key: 'allocated', label: 'Allocated' },
  { key: 'effectiveCap', label: 'Eff. cap' },
  { key: 'percentCap', label: '% cap' },
];

export function getActiveExtraColumns(columns: AllocationFilterState['columns']) {
  return EXTRA_COLUMN_META.filter((c) => columns[c.key]);
}

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

export function formatListAllocationAmount(
  raw: bigint | string | null | undefined,
  symbol: string,
  decimals: number
): string {
  if (raw == null) return `0 ${symbol}`;
  try {
    const value = typeof raw === 'bigint' ? raw : BigInt(raw);
    const displayDec = getTokenDisplayDecimals(symbol, decimals);
    return `${formatRawTokenAmount(value, decimals, displayDec)} ${symbol}`;
  } catch {
    return `— ${symbol}`;
  }
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

export function AllocationListShell({ children, className }: AllocationListShellProps) {
  return (
    <div className={cn('overflow-x-auto rounded-xl border bg-card', className)}>
      <div className="min-w-[76rem]">{children}</div>
    </div>
  );
}

export function AllocationListSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="border-b border-border/60 last:border-b-0">
      <div className="border-b border-border/60 bg-muted/30 px-4 py-2 text-xs font-medium text-muted-foreground">
        {title}
      </div>
      {children}
    </div>
  );
}

export function AllocationListHeader({
  columnLabels = [],
  editing = false,
}: {
  columnLabels?: ReadonlyArray<string>;
  editing?: boolean;
}) {
  const extraCount = columnLabels.length;
  return (
    <div
      className="grid items-center border-b px-4 py-3 text-sm font-medium text-foreground"
      style={{
        gridTemplateColumns: `minmax(0, 1fr) repeat(${extraCount}, 5rem) 7.5rem${editing ? ' 7rem' : ''}`,
      }}
    >
      <span>Allocation</span>
      {columnLabels.map((label) => (
        <span
          key={label}
          className="hidden text-right text-xs font-medium text-muted-foreground sm:block"
        >
          {label}
        </span>
      ))}
      <span className="text-right">Allocation</span>
      {editing && (
        <span className="text-right text-xs font-medium text-muted-foreground">New</span>
      )}
    </div>
  );
}

interface AllocationListRowProps {
  name: ReactNode;
  typeLabel?: string;
  tags?: ReactNode;
  amount: ReactNode;
  extraCells?: ReactNode;
  editingCell?: ReactNode;
  className?: string;
}

export function AllocationListRow({
  name,
  typeLabel,
  tags,
  amount,
  extraCells,
  editingCell,
  className,
  extraColumnCount = 0,
}: AllocationListRowProps & { extraColumnCount?: number }) {
  return (
    <div
      className={cn(
        'grid items-center gap-3 border-b border-border/60 px-4 py-4 last:border-b-0',
        className
      )}
      style={{
        gridTemplateColumns: `minmax(0, 1fr) repeat(${extraColumnCount}, 5rem) 7.5rem${editingCell ? ' 7rem' : ''}`,
      }}
    >
      <div className="flex min-w-0 items-center justify-between gap-4">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="truncate text-sm font-medium text-foreground">{name}</div>
          {tags}
        </div>
        {typeLabel && (
          <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">{typeLabel}</span>
        )}
      </div>
      {extraCells}
      <div className="text-right text-sm tabular-nums text-foreground">{amount}</div>
      {editingCell}
    </div>
  );
}

export function AllocationExtraColumn({
  value,
}: {
  label?: string;
  value: ReactNode;
}) {
  return (
    <div className="text-right text-xs tabular-nums">
      {value}
    </div>
  );
}

/** Morpho Curator–style fixed column grid for V2 allocations (desktop). */
export const CURATOR_ALLOCATION_GRID = {
  view: 'minmax(12rem, 1.6fr) 8.5rem 9rem 5rem 10rem 5rem 6.5rem',
  edit: 'minmax(12rem, 1.6fr) 8.5rem 9rem 5rem 10rem 5rem 6.5rem minmax(26rem, 1.5fr)',
} as const;

export function CuratorAllocationListHeader({ editing = false }: { editing?: boolean }) {
  return (
    <div
      className="grid items-center gap-x-5 border-b px-5 py-3.5 text-xs font-medium text-muted-foreground"
      style={{
        gridTemplateColumns: editing ? CURATOR_ALLOCATION_GRID.edit : CURATOR_ALLOCATION_GRID.view,
      }}
    >
      <span className="text-sm font-medium text-foreground">Allocation</span>
      <span className="text-right">Allocation</span>
      <span className="text-right">Eff. Abs. Cap</span>
      <span className="text-right">Rate</span>
      <span className="text-right">Liquidity</span>
      <span className="text-right">Util.</span>
      <span className="text-right">% Alloc.</span>
      {editing && <span className="text-right">Target</span>}
    </div>
  );
}

export function AllocationPctIndicator({ pct }: { pct: number }) {
  const active = pct > 0;
  return (
    <span className="inline-flex items-center justify-end gap-2">
      <span
        className={cn(
          'h-3.5 w-3.5 shrink-0 rounded-full border-2',
          active ? 'border-primary bg-primary' : 'border-muted-foreground/35 bg-transparent'
        )}
        aria-hidden
      />
      <span className="text-sm tabular-nums text-foreground">{pct.toFixed(2)}%</span>
    </span>
  );
}

interface CuratorAllocationListRowProps {
  name: ReactNode;
  tags?: ReactNode;
  allocationAmount: ReactNode;
  effectiveCap: ReactNode;
  rate: ReactNode;
  liquidity: ReactNode;
  utilization: ReactNode;
  percentAllocated: ReactNode;
  targetCell?: ReactNode;
  className?: string;
  editing?: boolean;
}

export function CuratorAllocationListRow({
  name,
  tags,
  allocationAmount,
  effectiveCap,
  rate,
  liquidity,
  utilization,
  percentAllocated,
  targetCell,
  className,
  editing = false,
}: CuratorAllocationListRowProps) {
  return (
    <div
      className={cn(
        'grid items-center gap-x-5 border-b border-border/60 px-5 py-4 last:border-b-0',
        className
      )}
      style={{
        gridTemplateColumns: editing ? CURATOR_ALLOCATION_GRID.edit : CURATOR_ALLOCATION_GRID.view,
      }}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <div className="truncate text-sm font-medium text-foreground">{name}</div>
        {tags}
      </div>
      <div className="text-right text-sm tabular-nums tracking-tight text-foreground">{allocationAmount}</div>
      <div className="text-right text-sm tabular-nums tracking-tight text-foreground">{effectiveCap}</div>
      <div className="text-right text-sm tabular-nums tracking-tight text-foreground">{rate}</div>
      <div className="text-right text-sm tabular-nums tracking-tight text-foreground">{liquidity}</div>
      <div className="text-right text-sm tabular-nums tracking-tight text-foreground">{utilization}</div>
      <div className="text-right">{percentAllocated}</div>
      {targetCell}
    </div>
  );
}
