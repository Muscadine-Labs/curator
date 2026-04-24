'use client';

import { useEffect, useRef, useState } from 'react';
import { Filter, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export type SortKey =
  | 'allocated-desc'
  | 'allocated-asc'
  | 'supplyApy-desc'
  | 'utilization-desc'
  | 'capacity-desc'
  | 'name-asc';

export interface AllocationFilterState {
  search: string;
  hideZero: boolean;
  onlyIdle: boolean;
  hideIdle: boolean;
  onlyWithCapacity: boolean;
  onlyEdited: boolean;
  sort: SortKey;
}

export const DEFAULT_FILTER_STATE: AllocationFilterState = {
  search: '',
  hideZero: false,
  onlyIdle: false,
  hideIdle: false,
  onlyWithCapacity: false,
  onlyEdited: false,
  sort: 'allocated-desc',
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

  const activeCount =
    (value.search ? 1 : 0) +
    (value.hideZero ? 1 : 0) +
    (value.onlyIdle ? 1 : 0) +
    (value.hideIdle ? 1 : 0) +
    (value.onlyWithCapacity ? 1 : 0) +
    (value.onlyEdited ? 1 : 0) +
    (value.sort !== DEFAULT_FILTER_STATE.sort ? 1 : 0);

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
        <div className="absolute right-0 z-30 mt-2 w-72 rounded-md border bg-popover p-3 shadow-md text-sm">
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

            <div>
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
