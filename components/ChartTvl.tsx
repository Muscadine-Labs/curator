'use client';

import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { formatCompactUSD } from '@/lib/format/number';
import { filterDataByRange, type TimeRange } from '@/lib/utils/date-filter';
import { TimeRangeFilter } from '@/components/charts/TimeRangeFilter';
import { SourceModeFilter, type ChartSourceMode } from '@/components/charts/SourceModeFilter';

interface ChartTvlProps {
  totalData?: Array<{ date: string; value: number }>;
  vaultData?: Array<{
    name: string;
    address: string;
    data: Array<{ date: string; value: number }>;
  }>;
  isLoading?: boolean;
  title?: string;
}

const VAULT_COLORS = [
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#ec4899',
  '#06b6d4',
  '#84cc16',
];

export function ChartTvl({ totalData, vaultData, isLoading = false, title = 'TVL Over Time' }: ChartTvlProps) {
  const [viewMode, setViewMode] = useState<ChartSourceMode>('total');
  const [range, setRange] = useState<TimeRange>('all');

  const filteredTotalData = useMemo(
    () => filterDataByRange(totalData || [], range),
    [totalData, range]
  );
  const filteredVaultData = useMemo(() => {
    if (!vaultData) return undefined;
    return vaultData.map((vault) => ({
      ...vault,
      data: filterDataByRange(vault.data, range),
    }));
  }, [vaultData, range]);

  const chartData = useMemo(() => {
    if (viewMode === 'total' || !filteredVaultData || filteredVaultData.length === 0) {
      return filteredTotalData;
    }

    const normalizedVaultData = filteredVaultData.map((vault) => {
      const dayMap = new Map<string, { date: string; value: number; timestamp: number }>();

      vault.data.forEach((point) => {
        const pointDate = new Date(point.date);
        const normalizedDate = new Date(pointDate);
        normalizedDate.setHours(0, 0, 0, 0);
        const dateKey = normalizedDate.toISOString();

        const existing = dayMap.get(dateKey);
        if (!existing || pointDate.getTime() > existing.timestamp) {
          dayMap.set(dateKey, {
            date: dateKey,
            value: point.value,
            timestamp: pointDate.getTime(),
          });
        }
      });

      return {
        ...vault,
        data: Array.from(dayMap.values()).map(({ date, value }) => ({ date, value })),
      };
    });

    const dateMap = new Map<string, Record<string, number | string>>();

    normalizedVaultData.forEach((vault) => {
      vault.data.forEach((point) => {
        if (!dateMap.has(point.date)) {
          dateMap.set(point.date, { date: point.date });
        }
        const entry = dateMap.get(point.date)!;
        entry[vault.name] = point.value;
      });
    });

    return Array.from(dateMap.values()).sort(
      (a, b) => new Date(a.date as string).getTime() - new Date(b.date as string).getTime()
    ) as Array<{ date: string; [key: string]: number | string }>;
  }, [viewMode, filteredTotalData, filteredVaultData]);

  const data = chartData;
  const showToggle = totalData && vaultData && vaultData.length > 0;

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!data || data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle>{title}</CardTitle>
            <TimeRangeFilter value={range} onChange={setRange} />
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex h-64 items-center justify-center text-muted-foreground">
            No data available
          </div>
        </CardContent>
      </Card>
    );
  }

  const formatTooltipValue = (value: number) => formatCompactUSD(value);
  const formatXAxisLabel = (tickItem: string) => {
    const date = new Date(tickItem);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const customTooltipContent = (props: {
    active?: boolean;
    payload?: Array<{ value?: number | string; name?: string; dataKey?: string; color?: string }>;
    label?: string | number;
  }) => {
    const { active, payload, label } = props;

    if (!active || !payload || payload.length === 0) {
      return null;
    }

    const validPayload = payload
      .map((entry) => {
        const raw = entry.value;
        const value = typeof raw === 'number' ? raw : Number(raw);
        if (value === null || value === undefined || isNaN(value)) {
          return null;
        }
        return { ...entry, value };
      })
      .filter((entry): entry is { value: number; name?: string; dataKey?: string; color?: string } => entry !== null);

    const sortedPayload =
      viewMode === 'byVault' ? [...validPayload].sort((a, b) => b.value - a.value) : validPayload;

    if (sortedPayload.length === 0) {
      return null;
    }

    return (
      <div className="max-w-[calc(100vw-2rem)] rounded-lg border bg-background p-2 shadow-md sm:max-w-none sm:p-3">
        <p className="mb-2 text-xs font-medium sm:text-sm">
          {new Date(label as string).toLocaleDateString()}
        </p>
        <div className="max-h-[60vh] space-y-1 overflow-y-auto">
          {sortedPayload.map((entry) => (
            <div key={entry.name || entry.dataKey} className="flex items-center gap-2">
              <div className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: entry.color }} />
              <span className="truncate text-xs font-medium sm:text-sm">{entry.name || 'TVL'}:</span>
              <span className="shrink-0 text-xs sm:text-sm">{formatTooltipValue(entry.value)}</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>{title}</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <TimeRangeFilter value={range} onChange={setRange} />
            {showToggle && (
              <SourceModeFilter value={viewMode} onChange={setViewMode} />
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" tickFormatter={formatXAxisLabel} tick={{ fontSize: 12 }} />
            <YAxis tickFormatter={(value) => formatCompactUSD(value)} tick={{ fontSize: 12 }} />
            <Tooltip content={customTooltipContent as never} />
            {viewMode === 'total' ? (
              <Line type="monotone" dataKey="value" stroke="#3b82f6" strokeWidth={2} dot={false} />
            ) : (
              <>
                {filteredVaultData?.map((vault, index) => (
                  <Line
                    key={vault.address}
                    type="monotone"
                    dataKey={vault.name}
                    stroke={VAULT_COLORS[index % VAULT_COLORS.length]}
                    strokeWidth={2}
                    dot={false}
                    name={vault.name}
                  />
                ))}
              </>
            )}
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
