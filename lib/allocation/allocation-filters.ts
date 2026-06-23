export type AllocationSortKey =
  | 'allocated-desc'
  | 'allocated-asc'
  | 'supplyApy-desc'
  | 'borrowApy-desc'
  | 'utilization-desc'
  | 'liquidity-desc'
  | 'liquidity-asc'
  | 'capacity-desc'
  | 'name-asc'
  | 'name-desc';

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
  'allocated-desc',
  'allocated-asc',
  'supplyApy-desc',
  'borrowApy-desc',
  'utilization-desc',
  'liquidity-desc',
  'liquidity-asc',
  'capacity-desc',
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
  sort: 'allocated-desc',
  columns: DEFAULT_COLUMN_STATE,
  displayMode: 'amount',
  amountUnit: 'token',
  liquidityUnit: 'both',
};
