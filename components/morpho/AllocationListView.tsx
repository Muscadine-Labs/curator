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
    <div className={cn('overflow-hidden rounded-xl border bg-card', className)}>
      {children}
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
  return (
    <div className="grid grid-cols-[1fr_auto] items-center border-b px-4 py-3 text-sm font-medium text-foreground">
      <span>Allocation</span>
      <div className="flex items-center gap-6">
        {columnLabels.map((label) => (
          <span
            key={label}
            className="hidden min-w-[4.5rem] text-right text-xs font-medium text-muted-foreground sm:block"
          >
            {label}
          </span>
        ))}
        <span className="min-w-[7.5rem] text-right">Allocation</span>
        {editing && (
          <span className="min-w-[7rem] text-right text-xs font-medium text-muted-foreground">
            New
          </span>
        )}
      </div>
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
}: AllocationListRowProps) {
  return (
    <div
      className={cn(
        'grid grid-cols-[1fr_auto] items-center gap-3 border-b border-border/60 px-4 py-4 last:border-b-0',
        className
      )}
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
      <div className="flex items-center gap-6">
        {extraCells}
        <div className="min-w-[7.5rem] text-right text-sm tabular-nums text-foreground">{amount}</div>
        {editingCell}
      </div>
    </div>
  );
}

export function AllocationExtraColumn({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="hidden min-w-[4.5rem] text-right sm:block">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="text-xs tabular-nums">{value}</div>
    </div>
  );
}
