export type AllocationSortKey =
  | 'default'
  | 'allocated-desc'
  | 'allocated-asc'
  | 'supplyApy-desc'
  | 'supplyApy-asc'
  | 'borrowApy-desc'
  | 'borrowApy-asc'
  | 'utilization-desc'
  | 'utilization-asc'
  | 'liquidity-desc'
  | 'liquidity-asc'
  | 'effectiveCap-desc'
  | 'effectiveCap-asc'
  | 'percentCap-desc'
  | 'percentCap-asc'
  | 'percentAlloc-desc'
  | 'percentAlloc-asc'
  | 'capacity-desc'
  | 'capacity-asc'
  | 'name-asc'
  | 'name-desc';

/** Clickable allocation table headers (3-state: desc → asc → default). */
export type AllocationHeaderSortColumn =
  | 'name'
  | 'utilization'
  | 'liquidity'
  | 'effectiveCap'
  | 'supplyApy'
  | 'borrowApy'
  | 'allocated'
  | 'percentCap'
  | 'percentAlloc';

const HEADER_SORT_KEYS: Record<
  AllocationHeaderSortColumn,
  { desc: AllocationSortKey; asc: AllocationSortKey }
> = {
  name: { desc: 'name-desc', asc: 'name-asc' },
  utilization: { desc: 'utilization-desc', asc: 'utilization-asc' },
  liquidity: { desc: 'liquidity-desc', asc: 'liquidity-asc' },
  effectiveCap: { desc: 'effectiveCap-desc', asc: 'effectiveCap-asc' },
  supplyApy: { desc: 'supplyApy-desc', asc: 'supplyApy-asc' },
  borrowApy: { desc: 'borrowApy-desc', asc: 'borrowApy-asc' },
  allocated: { desc: 'allocated-desc', asc: 'allocated-asc' },
  percentCap: { desc: 'percentCap-desc', asc: 'percentCap-asc' },
  percentAlloc: { desc: 'percentAlloc-desc', asc: 'percentAlloc-asc' },
};

export function cycleAllocationHeaderSort(
  current: AllocationSortKey,
  column: AllocationHeaderSortColumn
): AllocationSortKey {
  const pair = HEADER_SORT_KEYS[column];
  if (current === pair.desc) return pair.asc;
  if (current === pair.asc) return 'default';
  return pair.desc;
}

export function allocationHeaderSortDir(
  current: AllocationSortKey,
  column: AllocationHeaderSortColumn
): 'desc' | 'asc' | null {
  const pair = HEADER_SORT_KEYS[column];
  if (current === pair.desc) return 'desc';
  if (current === pair.asc) return 'asc';
  return null;
}

export type AllocationLiquidityUnit = 'both' | 'usd' | 'token';

export type AllocationDisplayMode = 'amount' | 'percent';

export type AllocationAmountUnit = 'usd' | 'token';

/** Which data columns the allocation table should show. */
export interface AllocationColumnState {
  utilization: boolean;
  liquidity: boolean;
  borrowApy: boolean;
  supplyApy: boolean;
  allocated: boolean;
  effectiveCap: boolean;
  percentCap: boolean;
}

export interface AllocationFilterState {
  search: string;
  hideZero: boolean;
  onlyIdle: boolean;
  hideIdle: boolean;
  onlyWithCapacity: boolean;
  onlyEdited: boolean;
  sort: AllocationSortKey;
  columns: AllocationColumnState;
  displayMode: AllocationDisplayMode;
  amountUnit: AllocationAmountUnit;
  liquidityUnit: AllocationLiquidityUnit;
}

export const ALLOCATION_SORT_KEYS = new Set<AllocationSortKey>([
  'default',
  'allocated-desc',
  'allocated-asc',
  'supplyApy-desc',
  'supplyApy-asc',
  'borrowApy-desc',
  'borrowApy-asc',
  'utilization-desc',
  'utilization-asc',
  'liquidity-desc',
  'liquidity-asc',
  'effectiveCap-desc',
  'effectiveCap-asc',
  'percentCap-desc',
  'percentCap-asc',
  'percentAlloc-desc',
  'percentAlloc-asc',
  'capacity-desc',
  'capacity-asc',
  'name-asc',
  'name-desc',
]);

export const ALLOCATION_COLUMN_KEYS = new Set<keyof AllocationColumnState>([
  'utilization',
  'liquidity',
  'borrowApy',
  'supplyApy',
  'allocated',
  'effectiveCap',
  'percentCap',
]);

export const ALLOCATION_DISPLAY_MODES = new Set<AllocationDisplayMode>(['amount', 'percent']);
export const ALLOCATION_AMOUNT_UNITS = new Set<AllocationAmountUnit>(['usd', 'token']);
export const ALLOCATION_LIQUIDITY_UNITS = new Set<AllocationLiquidityUnit>([
  'both',
  'usd',
  'token',
]);

export const DEFAULT_COLUMN_STATE: AllocationColumnState = {
  utilization: true,
  liquidity: true,
  borrowApy: false,
  supplyApy: true,
  allocated: false,
  effectiveCap: true,
  percentCap: false,
};

export const DEFAULT_FILTER_STATE: AllocationFilterState = {
  search: '',
  hideZero: false,
  onlyIdle: false,
  hideIdle: false,
  onlyWithCapacity: false,
  onlyEdited: false,
  sort: 'default',
  columns: DEFAULT_COLUMN_STATE,
  displayMode: 'amount',
  amountUnit: 'token',
  liquidityUnit: 'both',
};
