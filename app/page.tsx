'use client';

import { useMemo } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { KpiCard } from '@/components/KpiCard';
import { useProtocolStats } from '@/lib/hooks/useProtocolStats';
import { AppShell } from '@/components/layout/AppShell';
import { useRevenueSource, type RevenueSource } from '@/lib/RevenueSourceContext';

// Lazy load chart components to reduce initial bundle size
const ChartTvl = dynamic(() => import('@/components/ChartTvl').then(mod => ({ default: mod.ChartTvl })), {
  loading: () => <div className="h-72 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />,
  ssr: false,
});

const ChartInflows = dynamic(() => import('@/components/ChartInflows').then(mod => ({ default: mod.ChartInflows })), {
  loading: () => <div className="h-72 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />,
  ssr: false,
});

const ChartFees = dynamic(() => import('@/components/ChartFees').then(mod => ({ default: mod.ChartFees })), {
  loading: () => <div className="h-72 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />,
  ssr: false,
});

const ChartRevenue = dynamic(() => import('@/components/ChartRevenue').then(mod => ({ default: mod.ChartRevenue })), {
  loading: () => <div className="h-72 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />,
  ssr: false,
});

interface MonthlyStatementResponse {
  statements: Array<{
    month: string;
    total: { usd: number };
  }>;
  daily?: Array<{ date: string; value: number }>;
}

export default function Home() {
  const { data: stats, isLoading } = useProtocolStats();
  const { revenueSource, setRevenueSource } = useRevenueSource();

  const { data: monthlyData, isLoading: isTreasuryLoading } = useQuery<MonthlyStatementResponse>({
    queryKey: ['monthly-statement', 'wallet-balance'],
    queryFn: async () => {
      const res = await fetch('/api/monthly-statement-morphoql', { credentials: 'omit' });
      if (!res.ok) throw new Error('Failed to fetch monthly statement');
      return res.json();
    },
  });

  const treasuryRevenueDaily = useMemo(() => {
    const apiDaily = monthlyData?.daily;
    if (apiDaily && apiDaily.length > 0) {
      return apiDaily.slice().sort((a, b) => a.date.localeCompare(b.date));
    }
    const st = monthlyData?.statements ?? [];
    return st
      .slice()
      .sort((a, b) => a.month.localeCompare(b.month))
      .map((s) => ({ date: `${s.month}-01`, value: s.total.usd }));
  }, [monthlyData]);

  const treasuryRevenueCumulative = useMemo(() => {
    let sum = 0;
    return treasuryRevenueDaily.map((d) => {
      sum += d.value;
      return { date: d.date, value: sum };
    });
  }, [treasuryRevenueDaily]);

  const treasuryRevenueTotal = useMemo(() => {
    const statements = monthlyData?.statements ?? [];
    return statements.reduce((sum, s) => sum + s.total.usd, 0);
  }, [monthlyData?.statements]);

  const revenueTotal =
    revenueSource === 'treasury'
      ? treasuryRevenueTotal
      : (stats?.totalFeesGenerated ?? 0);
  const isRevenueLoading =
    revenueSource === 'treasury' ? isTreasuryLoading : isLoading;

  return (
    <AppShell
      title={
        <Link
          href="https://defillama.com/protocol/muscadine"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:underline"
        >
          Overview
        </Link>
      }
      description="Select a vault from the sidebar to view risk and configuration."
      actions={
        <select
          value={revenueSource}
          onChange={(e) => setRevenueSource(e.target.value as RevenueSource)}
          className="h-8 rounded-md border border-input bg-background px-2 py-0 text-xs ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        >
          <option value="defillama">DefiLlama</option>
          <option value="treasury">Treasury Wallet</option>
        </select>
      }
    >
      <div className="space-y-6">
        <div className="rounded-lg border bg-card/40 p-3 space-y-2.5">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-4">
            <p className="col-span-full text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Protocol
            </p>
            <KpiCard title="TVL" value={stats?.totalDeposited || 0} isLoading={isLoading} format="usd_full" compact className="border-0 bg-muted/40 shadow-none py-2" />
            <KpiCard
              title="Total Fees"
              value={stats?.totalInterestGenerated || 0}
              isLoading={isLoading}
              format="usd_full"
              compact
              className="border-0 bg-muted/40 shadow-none py-2"
            />
            <KpiCard title="Users" value={stats?.users || 0} isLoading={isLoading} format="number" compact className="border-0 bg-muted/40 shadow-none py-2" />
            <KpiCard
              title="Active Vaults"
              value={stats?.activeVaults || 0}
              isLoading={isLoading}
              format="number"
              compact
              className="border-0 bg-muted/40 shadow-none py-2"
            />
          </div>

          <div className="border-t border-border/60" />

          <div className="grid grid-cols-1 gap-2">
            <p className="col-span-full text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Revenue
              <span className="ml-1.5 font-normal normal-case tracking-normal text-muted-foreground/80">
                · {revenueSource === 'treasury' ? 'Treasury wallet' : 'DefiLlama'}
              </span>
            </p>
            <KpiCard
              title="Total Revenue"
              value={revenueTotal}
              isLoading={isRevenueLoading}
              format="usd"
              compact
              className="border-0 bg-muted/40 shadow-none py-2"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ChartTvl
            totalData={stats?.tvlTrend}
            vaultData={stats?.tvlByVault}
            isLoading={isLoading}
            title="TVL Over Time"
          />
          <ChartInflows
            dailyData={stats?.inflowsTrendDaily}
            cumulativeData={stats?.inflowsTrendCumulative}
            isLoading={isLoading}
            title="Inflows"
          />
          <ChartFees
            dailyData={stats?.feesTrendDaily}
            cumulativeData={stats?.feesTrendCumulative}
            isLoading={isLoading}
            title="Fees"
          />
          <ChartRevenue
            dailyData={stats?.revenueTrendDaily}
            cumulativeData={stats?.revenueTrendCumulative}
            treasuryDailyData={treasuryRevenueDaily}
            treasuryCumulativeData={treasuryRevenueCumulative}
            isLoading={isLoading}
            isTreasuryLoading={isTreasuryLoading}
            title="Revenue"
          />
        </div>
      </div>
    </AppShell>
  );
}
