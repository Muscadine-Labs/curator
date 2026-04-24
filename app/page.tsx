'use client';

import { useMemo } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { KpiCard } from '@/components/KpiCard';
import { useProtocolStats, useVaultList } from '@/lib/hooks/useProtocolStats';
import { AppShell } from '@/components/layout/AppShell';
import { useRevenueSource, type RevenueSource } from '@/lib/RevenueSourceContext';
import { formatCompactUSD } from '@/lib/format/number';
import { shouldUseV2Query } from '@/lib/config/vaults';

// Lazy load chart components to reduce initial bundle size
const ChartTvl = dynamic(() => import('@/components/ChartTvl').then(mod => ({ default: mod.ChartTvl })), {
  loading: () => <div className="h-96 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />,
  ssr: false,
});

const ChartInflows = dynamic(() => import('@/components/ChartInflows').then(mod => ({ default: mod.ChartInflows })), {
  loading: () => <div className="h-96 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />,
  ssr: false,
});

const ChartFees = dynamic(() => import('@/components/ChartFees').then(mod => ({ default: mod.ChartFees })), {
  loading: () => <div className="h-96 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />,
  ssr: false,
});

const ChartRevenue = dynamic(() => import('@/components/ChartRevenue').then(mod => ({ default: mod.ChartRevenue })), {
  loading: () => <div className="h-96 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />,
  ssr: false,
});

interface MonthlyStatementResponse {
  statements: Array<{ month: string; total: { usd: number } }>;
  daily?: Array<{ date: string; value: number }>;
}

export default function Home() {
  const { data: stats, isLoading } = useProtocolStats();
  const { data: vaults = [], isLoading: isVaultListLoading } = useVaultList();
  const { revenueSource, setRevenueSource } = useRevenueSource();

  const { data: monthlyData, isLoading: isTreasuryLoading } = useQuery<MonthlyStatementResponse>({
    queryKey: ['monthly-statement'],
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
          className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        >
          <option value="defillama">DefiLlama</option>
          <option value="treasury">Treasury Wallet</option>
        </select>
      }
    >
      <div className="space-y-10">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <KpiCard
            title="Total Deposited"
            value={stats?.totalDeposited || 0}
            subtitle="Across all vaults"
            isLoading={isLoading}
            format="usd"
            compact
          />
          <KpiCard
            title="Total Fees Generated"
            value={stats?.totalInterestGenerated || 0}
            subtitle="Total fees collected to token holders"
            isLoading={isLoading}
            format="usd"
            compact
          />
          <KpiCard
            title="Total Revenue Generated"
            value={
              revenueSource === 'treasury'
                ? (treasuryRevenueCumulative?.length ? treasuryRevenueCumulative[treasuryRevenueCumulative.length - 1].value : 0)
                : (stats?.totalFeesGenerated ?? 0)
            }
            subtitle="Total revenue to protocol"
            isLoading={revenueSource === 'treasury' ? isTreasuryLoading : isLoading}
            format="usd"
            compact
          />
          <KpiCard
            title="Active Vaults"
            value={stats?.activeVaults || 0}
            subtitle="Currently active"
            isLoading={isLoading}
            format="number"
            compact
          />
          <KpiCard
            title="Users"
            value={stats?.users || 0}
            subtitle="Total depositors"
            isLoading={isLoading}
            format="number"
            compact
          />
        </div>

        {revenueSource === 'treasury' && (
          <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-4 dark:border-slate-700 dark:bg-slate-800/30">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Revenue by Vault (Treasury)
            </h3>
            {isVaultListLoading ? (
              <div className="h-8 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
            ) : (
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                {vaults
                  .filter((v) => v.revenueAllTime != null && v.revenueAllTime > 0)
                  .sort((a, b) => (b.revenueAllTime ?? 0) - (a.revenueAllTime ?? 0))
                  .map((vault) => (
                    <Link
                      key={vault.address}
                      href={
                        shouldUseV2Query(vault.name, vault.address)
                          ? `/vault/v2/${vault.address}`
                          : `/vault/v1/${vault.address}`
                      }
                      className="hover:underline"
                    >
                      <span className="text-slate-700 dark:text-slate-300">{vault.name}:</span>{' '}
                      <span className="font-medium text-slate-900 dark:text-slate-100">
                        {formatCompactUSD(vault.revenueAllTime ?? 0)}
                      </span>
                    </Link>
                  ))}
                {vaults.filter((v) => v.revenueAllTime != null && v.revenueAllTime > 0).length === 0 && (
                  <span className="text-slate-500 dark:text-slate-400">No vault revenue yet</span>
                )}
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
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
