'use client';

import { FlowTrendCard } from '@/components/charts/FlowTrendCard';

interface ChartFeesProps {
  dailyData?: Array<{ date: string; value: number }>;
  cumulativeData?: Array<{ date: string; value: number }>;
  isLoading?: boolean;
  title?: string;
}

export function ChartFees({
  dailyData,
  cumulativeData,
  isLoading = false,
  title = 'Fees',
}: ChartFeesProps) {
  return (
    <FlowTrendCard
      title={title}
      noun="fees"
      color="#10b981"
      dailyData={dailyData}
      cumulativeData={cumulativeData}
      isLoading={isLoading}
    />
  );
}
