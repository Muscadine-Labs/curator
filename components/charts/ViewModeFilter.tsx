'use client';

import { BarChart3 } from 'lucide-react';
import { ChartModeFilter, type ChartModeOption } from '@/components/charts/ChartModeFilter';

/**
 * Flow charts (inflows, fees, revenue). `daily` and `dailyChange` are the 1st
 * and 2nd derivative of `cumulative`, computed from the cumulative series
 * (`flowViewSeries`).
 */
export type ChartViewMode = 'cumulative' | 'daily' | 'dailyChange';

const OPTIONS: ReadonlyArray<ChartModeOption<ChartViewMode>> = [
  { value: 'cumulative', label: 'Cumulative' },
  { value: 'daily', label: '1st derivative', hint: 'Daily amount · 7D avg' },
  { value: 'dailyChange', label: '2nd derivative', hint: 'Change in daily amount · 7D avg' },
];

/** Derivative order of a flow view relative to the cumulative series. */
export function flowViewOrder(mode: ChartViewMode): 0 | 1 | 2 {
  return mode === 'cumulative' ? 0 : mode === 'daily' ? 1 : 2;
}

interface ViewModeFilterProps {
  value: ChartViewMode;
  onChange: (value: ChartViewMode) => void;
}

/** View dropdown for flow charts: Cumulative / 1st derivative / 2nd derivative. */
export function ViewModeFilter({ value, onChange }: ViewModeFilterProps) {
  return <ChartModeFilter value={value} onChange={onChange} options={OPTIONS} icon={BarChart3} />;
}
