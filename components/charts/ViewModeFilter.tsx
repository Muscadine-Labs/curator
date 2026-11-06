'use client';

import { BarChart3 } from 'lucide-react';
import { ChartModeFilter, type ChartModeOption } from '@/components/charts/ChartModeFilter';

/**
 * Flow charts (inflows, fees, revenue). `daily` is already the 1st derivative
 * of `cumulative`; `dailyChange` is the 2nd (per-day change in the daily flow).
 */
export type ChartViewMode = 'cumulative' | 'daily' | 'dailyChange';

const OPTIONS: ReadonlyArray<ChartModeOption<ChartViewMode>> = [
  { value: 'cumulative', label: 'Cumulative' },
  { value: 'daily', label: 'Daily', hint: '1st derivative · 7D avg' },
  { value: 'dailyChange', label: 'Daily change', hint: '2nd derivative · 7D avg' },
];

/** Derivative order of a flow view relative to the cumulative series. */
export function flowViewOrder(mode: ChartViewMode): 0 | 1 | 2 {
  return mode === 'cumulative' ? 0 : mode === 'daily' ? 1 : 2;
}

interface ViewModeFilterProps {
  value: ChartViewMode;
  onChange: (value: ChartViewMode) => void;
}

/** View dropdown for flow charts: Cumulative / Daily / Daily change. */
export function ViewModeFilter({ value, onChange }: ViewModeFilterProps) {
  return <ChartModeFilter value={value} onChange={onChange} options={OPTIONS} icon={BarChart3} />;
}
