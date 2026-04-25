'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Shield } from 'lucide-react';
import { getScanUrlForChain, getScanNameForChain } from '@/lib/constants';
import { useVaultV1Complete } from '@/lib/hooks/useVaultV1Complete';
import { AppShell } from '@/components/layout/AppShell';
import { KpiCard } from '@/components/KpiCard';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { MarketRiskV1 } from '@/components/morpho/MarketRiskV1';
import { VaultRiskV1 } from '@/components/morpho/VaultRiskV1';
import { AllocationV1 } from '@/components/morpho/AllocationV1';
import { VaultRolesV1 } from '@/components/morpho/VaultRolesV1';
import { VaultParametersV1 } from '@/components/morpho/VaultParametersV1';
import { VaultCapsV1 } from '@/components/morpho/VaultCapsV1';
import { VaultQueuesV1 } from '@/components/morpho/VaultQueuesV1';
import { VaultHolders } from '@/components/morpho/VaultHolders';
import { VaultTransactions } from '@/components/morpho/VaultTransactions';
import { AllocationHistory } from '@/components/morpho/AllocationHistory';

export default function VaultDetailPage() {
  const params = useParams();
  const vaultAddress = params.address as string;
  // Load all data in parallel - hooks will fetch independently
  // Only block on vault data loading (needed for basic info)
  const { vault, roles, caps, queues, marketRisk, vaultIsLoading, isError, error } = useVaultV1Complete(vaultAddress);

  // Only block on vault data loading (needed for basic info)
  // Other data (roles, caps, queues, marketRisk) will load in parallel via their own hooks
  if (vaultIsLoading) {
    return (
      <AppShell title="Loading vault..." description="Fetching vault data">
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-3">
            {[...Array(6)].map((_, idx) => (
              <Skeleton key={idx} className="h-24 w-full rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-96 w-full rounded-xl" />
        </div>
      </AppShell>
    );
  }

  if (isError || !vault) {
    return (
      <AppShell title="Error loading vault" description={error instanceof Error ? error.message : 'Failed to load vault data'}>
        <Card>
          <CardHeader>
            <CardTitle>Error</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-red-600 dark:text-red-400">
              {error instanceof Error ? error.message : 'Failed to load vault data'}
            </p>
            <Button asChild className="w-full sm:w-auto">
              <Link href="/vaults">Back to vaults</Link>
            </Button>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  if (!vault) {
    return (
      <AppShell title="Vault not found" description="The vault you're looking for doesn't exist.">
        <Card>
          <CardHeader>
            <CardTitle>Missing vault</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-slate-600 dark:text-slate-400">Check the address or pick a vault from the sidebar.</p>
            <Button asChild className="w-full sm:w-auto">
              <Link href="/vaults">Back to vaults</Link>
            </Button>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  const morphoUiUrl = vault.address 
    ? `https://app.morpho.org/base/vault/${vault.address.toLowerCase()}`
    : '#';

  return (
    <AppShell
      title="Vault Details"
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="default" className="flex items-center gap-1 bg-blue-600 text-xs sm:text-sm">
            <Shield className="h-3 w-3" /> V1
          </Badge>
          <Button variant="outline" size="sm" asChild className="text-xs sm:text-sm">
            <a href={vault.address ? `${getScanUrlForChain(vault.chainId)}/address/${vault.address}` : '#'} target="_blank" rel="noreferrer">
              <span className="hidden sm:inline">View on {getScanNameForChain(vault.chainId)}</span>
              <span className="sm:hidden">{getScanNameForChain(vault.chainId)}</span>
            </a>
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        <Tabs defaultValue="overview" className="space-y-4">
          <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 scrollbar-hide sm:overflow-visible">
            <TabsList className="inline-flex w-auto min-w-full sm:min-w-0 sm:w-full justify-start gap-1">
              <TabsTrigger value="overview" className="sm:flex-1 flex-shrink-0 min-w-fit">Overview</TabsTrigger>
              <TabsTrigger value="risk" className="sm:flex-1 flex-shrink-0 min-w-fit">
                <span className="hidden sm:inline">Risk Management</span>
                <span className="sm:hidden">Risk</span>
              </TabsTrigger>
              <TabsTrigger value="roles" className="sm:flex-1 flex-shrink-0 min-w-fit">Roles</TabsTrigger>
              <TabsTrigger value="allocation" className="sm:flex-1 flex-shrink-0 min-w-fit">Allocation</TabsTrigger>
              <TabsTrigger value="caps" className="sm:flex-1 flex-shrink-0 min-w-fit">Caps</TabsTrigger>
              <TabsTrigger value="parameters" className="sm:flex-1 flex-shrink-0 min-w-fit">Parameters</TabsTrigger>
              <TabsTrigger value="queues" className="sm:flex-1 flex-shrink-0 min-w-fit">Queues</TabsTrigger>
              <TabsTrigger value="emergency" className="sm:flex-1 flex-shrink-0 min-w-fit">Emergency</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="risk" className="space-y-4">
            <VaultRiskV1 vaultAddress={vaultAddress} preloadedData={marketRisk} />
            <MarketRiskV1 vaultAddress={vaultAddress} preloadedData={marketRisk} />
          </TabsContent>

          <TabsContent value="overview" className="space-y-6">
            {/* Header: Name, Ticker, Asset */}
            <Card>
              <CardContent className="pt-6">
                <div className="flex flex-col gap-3">
                  <div>
                    <a
                      href={morphoUiUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xl sm:text-2xl font-semibold text-slate-900 dark:text-slate-100 hover:text-blue-600 dark:hover:text-blue-400 transition-colors break-words"
                    >
                      {vault.name}
                    </a>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="text-sm">
                      {vault.symbol}
                    </Badge>
                    <Badge variant="outline" className="text-sm">
                      {vault.asset}
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Metrics Grid */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <KpiCard title="TVL" value={vault.tvl} subtitle="Total Value Locked" format="usd" />
              <KpiCard title="APY" value={vault.apy} subtitle="Current yield rate" format="percentage" />
              <KpiCard title="Depositors" value={vault.depositors} subtitle="Total depositors" format="number" />
              <KpiCard 
                title="Performance Fee" 
                value={vault.parameters?.performanceFeePercent ?? (vault.parameters?.performanceFeeBps ? vault.parameters.performanceFeeBps / 100 : null)} 
                subtitle="Curator fee rate" 
                format="percentage" 
              />
              <KpiCard title="Revenue (All Time)" value={vault.revenueAllTime} subtitle="Total revenue to protocol" format="usd" />
              <KpiCard title="Fees (All Time)" value="Coming Soon" subtitle="Total fees collected to token holders" format="raw" />
            </div>

            {/* Holders — placed under Fee/Revenue */}
            <VaultHolders
              vaultAddress={vault.address}
              chainId={vault.chainId}
              assetDecimals={vault.assetDecimals}
              assetSymbol={vault.asset}
            />

            {/* Transactions — last ~100 deposits/withdraws/interactions */}
            <VaultTransactions
              vaultAddress={vault.address}
              chainId={vault.chainId}
              assetDecimals={vault.assetDecimals}
              assetSymbol={vault.asset}
            />
          </TabsContent>

          <TabsContent value="roles" className="space-y-4">
            <VaultRolesV1 vaultAddress={vaultAddress} preloadedData={roles} />
          </TabsContent>

          <TabsContent value="parameters" className="space-y-4">
            <VaultParametersV1 vaultAddress={vaultAddress} />
          </TabsContent>

          <TabsContent value="allocation" className="space-y-4">
            <AllocationV1 vaultAddress={vaultAddress} />
            <AllocationHistory
              vaultAddress={vault.address}
              chainId={vault.chainId}
              assetDecimals={vault.assetDecimals}
              assetSymbol={vault.asset}
            />
          </TabsContent>

          <TabsContent value="caps" className="space-y-4">
            <VaultCapsV1 vaultAddress={vaultAddress} preloadedData={caps} />
          </TabsContent>

          <TabsContent value="queues" className="space-y-4">
            <VaultQueuesV1 vaultAddress={vaultAddress} preloadedData={queues} />
          </TabsContent>

          <TabsContent value="emergency" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Emergency</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-center py-8 text-slate-500 dark:text-slate-400">Coming Soon</p>
                <div className="text-center">
                  <Button variant="outline" asChild>
                    <a
                      href="https://curator-v1.morpho.org/emergency"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Visit Emergency Page
                    </a>
                  </Button>
                </div>
                <p className="text-center text-sm text-slate-600 dark:text-slate-400">
                  For any emergency, visit{' '}
                  <a
                    href="https://curator-v1.morpho.org/emergency"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 underline"
                  >
                    https://curator-v1.morpho.org/emergency
                  </a>
                </p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
