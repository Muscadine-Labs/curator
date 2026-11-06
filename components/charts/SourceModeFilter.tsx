'use client';

import { Layers } from 'lucide-react';
import { ChartModeFilter, type ChartModeOption } from '@/components/charts/ChartModeFilter';

/**
 * Level charts (TVL): the aggregate, the per-vault breakdown, or the
 * aggregate's 1st / 2nd derivative.
 */
export type ChartSourceMode = 'total' | 'byVault' | 'change' | 'acceleration';

/** Derivative order of the total series for a source mode (`byVault` is 0). */
export function sourceModeOrder(mode: ChartSourceMode): 0 | 1 | 2 {
  return mode === 'change' ? 1 : mode === 'acceleration' ? 2 : 0;
}

interface SourceModeFilterProps {
  value: ChartSourceMode;
  onChange: (value: ChartSourceMode) => void;
  breakdownLabel?: string;
  /** Omit the breakdown option (no per-vault data). */
  showBreakdown?: boolean;
}

/**
 * View dropdown for the TVL chart: Total, per-vault breakdown, and the
 * total's daily change (1st derivative) and change in daily change (2nd).
 */
export function SourceModeFilter({
  value,
  onChange,
  breakdownLabel = 'By Vault',
  showBreakdown = true,
}: SourceModeFilterProps) {
  const options: Array<ChartModeOption<ChartSourceMode>> = [
    { value: 'total', label: 'Total' },
    ...(showBreakdown ? [{ value: 'byVault' as const, label: breakdownLabel }] : []),
    { value: 'change', label: 'Daily change', hint: '1st derivative · 7D avg' },
    { value: 'acceleration', label: 'Change in daily change', hint: '2nd derivative · 7D avg' },
  ];
  return <ChartModeFilter value={value} onChange={onChange} options={options} icon={Layers} />;
}
