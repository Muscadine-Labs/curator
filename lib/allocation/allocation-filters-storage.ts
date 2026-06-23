import {
  ALLOCATION_AMOUNT_UNITS,
  ALLOCATION_COLUMN_KEYS,
  ALLOCATION_DISPLAY_MODES,
  ALLOCATION_LIQUIDITY_UNITS,
  ALLOCATION_SORT_KEYS,
  DEFAULT_FILTER_STATE,
  type AllocationFilterState,
} from '@/lib/allocation/allocation-filters';

const STORAGE_PREFIX = 'curator-allocation-filters';

function storageKey(vaultAddress: string): string {
  return `${STORAGE_PREFIX}:${vaultAddress.toLowerCase()}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mergeColumns(
  defaults: AllocationFilterState['columns'],
  saved: unknown
): AllocationFilterState['columns'] {
  if (!isRecord(saved)) return defaults;
  const next = { ...defaults };
  for (const key of ALLOCATION_COLUMN_KEYS) {
    if (typeof saved[key] === 'boolean') {
      next[key] = saved[key];
    }
  }
  return next;
}

/** Merge saved preferences with defaults so new filter fields keep working. */
export function mergeAllocationFilters(
  defaults: AllocationFilterState,
  saved: unknown
): AllocationFilterState {
  if (!isRecord(saved)) return defaults;

  const sort = saved.sort;
  const displayMode = saved.displayMode;
  const amountUnit = saved.amountUnit;
  const liquidityUnit = saved.liquidityUnit;

  return {
    search: typeof saved.search === 'string' ? saved.search : defaults.search,
    hideZero: typeof saved.hideZero === 'boolean' ? saved.hideZero : defaults.hideZero,
    onlyIdle: typeof saved.onlyIdle === 'boolean' ? saved.onlyIdle : defaults.onlyIdle,
    hideIdle: typeof saved.hideIdle === 'boolean' ? saved.hideIdle : defaults.hideIdle,
    onlyWithCapacity:
      typeof saved.onlyWithCapacity === 'boolean'
        ? saved.onlyWithCapacity
        : defaults.onlyWithCapacity,
    onlyEdited: typeof saved.onlyEdited === 'boolean' ? saved.onlyEdited : defaults.onlyEdited,
    sort:
      typeof sort === 'string' && ALLOCATION_SORT_KEYS.has(sort as AllocationFilterState['sort'])
        ? (sort as AllocationFilterState['sort'])
        : defaults.sort,
    columns: mergeColumns(defaults.columns, saved.columns),
    displayMode:
      typeof displayMode === 'string' &&
      ALLOCATION_DISPLAY_MODES.has(displayMode as AllocationFilterState['displayMode'])
        ? (displayMode as AllocationFilterState['displayMode'])
        : defaults.displayMode,
    amountUnit:
      typeof amountUnit === 'string' &&
      ALLOCATION_AMOUNT_UNITS.has(amountUnit as AllocationFilterState['amountUnit'])
        ? (amountUnit as AllocationFilterState['amountUnit'])
        : defaults.amountUnit,
    liquidityUnit:
      typeof liquidityUnit === 'string' &&
      ALLOCATION_LIQUIDITY_UNITS.has(liquidityUnit as AllocationFilterState['liquidityUnit'])
        ? (liquidityUnit as AllocationFilterState['liquidityUnit'])
        : defaults.liquidityUnit,
  };
}

export function loadAllocationFilters(vaultAddress: string): AllocationFilterState {
  if (typeof window === 'undefined') return DEFAULT_FILTER_STATE;
  try {
    const raw = localStorage.getItem(storageKey(vaultAddress));
    if (!raw) return DEFAULT_FILTER_STATE;
    return mergeAllocationFilters(DEFAULT_FILTER_STATE, JSON.parse(raw));
  } catch {
    return DEFAULT_FILTER_STATE;
  }
}

export function saveAllocationFilters(
  vaultAddress: string,
  filters: AllocationFilterState
): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(storageKey(vaultAddress), JSON.stringify(filters));
  } catch {
    /* ignore quota / private mode */
  }
}

export function clearAllocationFilters(vaultAddress: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(storageKey(vaultAddress));
  } catch {
    /* ignore */
  }
}
