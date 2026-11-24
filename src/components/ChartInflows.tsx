'use client';

import { FlowTrendCard } from '@/components/charts/FlowTrendCard';

interface ChartInflowsProps {
  dailyData?: Array<{ date: string; value: number }>;
  cumulativeData?: Array<{ date: string; value: number }>;
  isLoading?: boolean;
  title?: string;
}

export function ChartInflows({
  dailyData,
  cumulativeData,
  isLoading = false,
  title = 'Inflows',
}: ChartInflowsProps) {
  return (
    <FlowTrendCard
      title={title}
      noun="inflows"
      color="#f59e0b"
      dailyData={dailyData}
      cumulativeData={cumulativeData}
      isLoading={isLoading}
    />
  );
}
