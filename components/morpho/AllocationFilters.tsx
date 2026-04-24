'use client';

import { useEffect, useRef, useState } from 'react';
import { Filter, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

type SortKey =
  | 'allocated-desc'
  | 'allocated-asc'
  | 'supplyApy-desc'
  | 'utilization-desc'
  | 'capacity-desc'
  | 'name-asc';

/**
 * Which data columns the allocation table should show.
 * Kept flat so components can do `if (filters.columns.utilization)`.
 */
interface AllocationColumnState {
  utilization: boolean;
  liquidity: boolean;
  borrowApy: boolean;
  supplyApy: boolean;
  allocated: boolean;
  cap: boolean;
}

/**
 * Display mode for the Allocated / Cap columns.
 * - 'amount'  — raw token amount (e.g. "12,345.67 USDC")
 * - 'percent' — share of total vault allocation (e.g. "12.34%")
 */
type AllocationDisplayMode = 'amount' | 'percent';

export interface AllocationFilterState {
  search: string;
  hideZero: boolean;
  onlyIdle: boolean;
  hideIdle: boolean;
  onlyWithCapacity: boolean;
  onlyEdited: boolean;
  sort: SortKey;
  columns: AllocationColumnState;
  displayMode: AllocationDisplayMode;
}

const DEFAULT_COLUMN_STATE: AllocationColumnState = {
  utilization: true,
  liquidity: true,
  borrowApy: true,
  supplyApy: true,
  allocated: true,
  cap: true,
};

export const DEFAULT_FILTER_STATE: AllocationFilterState = {
  search: '',
  hideZero: false,
  onlyIdle: false,
  hideIdle: false,
  onlyWithCapacity: false,
  onlyEdited: false,
  sort: 'allocated-desc',
  columns: DEFAULT_COLUMN_STATE,
  displayMode: 'amount',
};

interface AllocationFiltersProps {
  value: AllocationFilterState;
  onChange: (next: AllocationFilterState) => void;
  editing?: boolean;
  showIdleToggles?: boolean;
}

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'allocated-desc', label: 'Allocated (high → low)' },
  { key: 'allocated-asc', label: 'Allocated (low → high)' },
  { key: 'supplyApy-desc', label: 'Supply APY (high → low)' },
  { key: 'utilization-desc', label: 'Utilization (high → low)' },
  { key: 'capacity-desc', label: 'Remaining capacity (high → low)' },
  { key: 'name-asc', label: 'Market (A → Z)' },
];

const COLUMN_OPTIONS: { key: keyof AllocationColumnState; label: string }[] = [
  { key: 'utilization', label: 'Utilization' },
  { key: 'liquidity', label: 'Liquidity' },
  { key: 'borrowApy', label: 'Borrow APY' },
  { key: 'supplyApy', label: 'Supply APY' },
  { key: 'allocated', label: 'Allocated' },
  { key: 'cap', label: 'Cap' },
];

export function AllocationFilters({ value, onChange, editing = false, showIdleToggles = true }: AllocationFiltersProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const update = (patch: Partial<AllocationFilterState>) => onChange({ ...value, ...patch });
  const updateColumn = (key: keyof AllocationColumnState, v: boolean) =>
    update({ columns: { ...value.columns, [key]: v } });

  const hiddenColumnCount = COLUMN_OPTIONS.filter((c) => !value.columns[c.key]).length;

  const activeCount =
    (value.search ? 1 : 0) +
    (value.hideZero ? 1 : 0) +
    (value.onlyIdle ? 1 : 0) +
    (value.hideIdle ? 1 : 0) +
    (value.onlyWithCapacity ? 1 : 0) +
    (value.onlyEdited ? 1 : 0) +
    (value.sort !== DEFAULT_FILTER_STATE.sort ? 1 : 0) +
    (hiddenColumnCount > 0 ? 1 : 0) +
    (value.displayMode !== DEFAULT_FILTER_STATE.displayMode ? 1 : 0);

  const clearAll = () => onChange(DEFAULT_FILTER_STATE);

  return (
    <div className="relative" ref={containerRef}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5"
      >
        <Filter className="h-3.5 w-3.5" /> Filters
        {activeCount > 0 && (
          <span className="ml-1 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold px-1.5 py-0.5">
            {activeCount}
          </span>
        )}
      </Button>

      {open && (
        <div className="absolute right-0 z-30 mt-2 w-80 rounded-md border bg-popover p-3 shadow-md text-sm">
          <div className="flex items-center justify-between mb-3">
            <span className="font-medium">Filter markets</span>
            <button
              type="button"
              onClick={clearAll}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              <X className="h-3 w-3" /> Clear
            </button>
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Search</label>
              <Input
                type="text"
                placeholder="Market or asset…"
                value={value.search}
                onChange={(e) => update({ search: e.target.value })}
                className="h-8 text-xs"
              />
            </div>

            <FilterCheckbox
              label="Hide zero allocations"
              checked={value.hideZero}
              onChange={(v) => update({ hideZero: v })}
            />

            {showIdleToggles && (
              <>
                <FilterCheckbox
                  label="Show only idle markets"
                  checked={value.onlyIdle}
                  disabled={value.hideIdle}
                  onChange={(v) => update({ onlyIdle: v, hideIdle: v ? false : value.hideIdle })}
                />
                <FilterCheckbox
                  label="Hide idle markets"
                  checked={value.hideIdle}
                  disabled={value.onlyIdle}
                  onChange={(v) => update({ hideIdle: v, onlyIdle: v ? false : value.onlyIdle })}
                />
              </>
            )}

            <FilterCheckbox
              label="Only markets with remaining capacity"
              checked={value.onlyWithCapacity}
              onChange={(v) => update({ onlyWithCapacity: v })}
            />

            {editing && (
              <FilterCheckbox
                label="Only edited rows"
                checked={value.onlyEdited}
                onChange={(v) => update({ onlyEdited: v })}
              />
            )}

            <div className="pt-1 border-t">
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-muted-foreground">Columns</label>
                <button
                  type="button"
                  onClick={() =>
                    update({
                      columns: COLUMN_OPTIONS.reduce(
                        (acc, c) => ({ ...acc, [c.key]: true }),
                        {} as AllocationColumnState
                      ),
                    })
                  }
                  className="text-[10px] text-muted-foreground hover:text-foreground"
                >
                  Show all
                </button>
              </div>
              <div className="grid grid-cols-2 gap-x-2 gap-y-1">
                {COLUMN_OPTIONS.map((c) => (
                  <FilterCheckbox
                    key={c.key}
                    label={c.label}
                    checked={value.columns[c.key]}
                    onChange={(v) => updateColumn(c.key, v)}
                  />
                ))}
              </div>
            </div>

            <div className="pt-1 border-t">
              <label className="text-xs text-muted-foreground mb-1 block">
                Show Allocated / Cap as
              </label>
              <div className="flex gap-0.5 rounded-md border p-0.5">
                <button
                  type="button"
                  onClick={() => update({ displayMode: 'amount' })}
                  className={cn(
                    'flex-1 px-2 py-1 rounded text-xs font-medium transition-colors',
                    value.displayMode === 'amount'
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  Amount
                </button>
                <button
                  type="button"
                  onClick={() => update({ displayMode: 'percent' })}
                  className={cn(
                    'flex-1 px-2 py-1 rounded text-xs font-medium transition-colors',
                    value.displayMode === 'percent'
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  Percent
                </button>
              </div>
            </div>

            <div className="pt-1 border-t">
              <label className="text-xs text-muted-foreground mb-1 block">Sort by</label>
              <select
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                value={value.sort}
                onChange={(e) => update({ sort: e.target.value as SortKey })}
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.key} value={o.key}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FilterCheckbox({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      className={cn(
        'flex items-center gap-2 cursor-pointer select-none',
        disabled && 'opacity-50 cursor-not-allowed'
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 rounded border-input accent-primary"
      />
      <span className="text-xs">{label}</span>
    </label>
  );
}
