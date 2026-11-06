'use client';

import { FlowTrendCard } from '@/components/charts/FlowTrendCard';
import { useRevenueSource } from '@/lib/RevenueSourceContext';

interface ChartRevenueProps {
  dailyData?: Array<{ date: string; value: number }>;
  cumulativeData?: Array<{ date: string; value: number }>;
  treasuryDailyData?: Array<{ date: string; value: number }>;
  treasuryCumulativeData?: Array<{ date: string; value: number }>;
  isLoading?: boolean;
  isTreasuryLoading?: boolean;
  title?: string;
}

/** Revenue from the selected source (DefiLlama or treasury wallet). */
export function ChartRevenue({
  dailyData,
  cumulativeData,
  treasuryDailyData,
  treasuryCumulativeData,
  isLoading = false,
  isTreasuryLoading = false,
  title = 'Revenue',
}: ChartRevenueProps) {
  const { revenueSource } = useRevenueSource();
  const treasury = revenueSource === 'treasury';
  return (
    <FlowTrendCard
      title={title}
      noun="revenue"
      color="#8b5cf6"
      dailyData={treasury ? treasuryDailyData : dailyData}
      cumulativeData={treasury ? treasuryCumulativeData : cumulativeData}
      isLoading={treasury ? isTreasuryLoading : isLoading}
    />
  );
}
