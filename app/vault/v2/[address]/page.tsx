'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Shield } from 'lucide-react';
import { getScanUrlForChain, getScanNameForChain } from '@/lib/constants';
import { useVaultV2Complete } from '@/lib/hooks/useVaultV2Complete';
import { getVaultCategory } from '@/lib/config/vaults';
import { AppShell } from '@/components/layout/AppShell';
import { VaultOverviewPanel } from '@/components/morpho/VaultOverviewPanel';
import { VaultRiskV2 } from '@/components/morpho/VaultRiskV2';
import { VaultV2Roles } from '@/components/morpho/VaultV2Roles';
import { VaultV2Adapters } from '@/components/morpho/VaultV2Adapters';
import { VaultV2Allocations } from '@/components/morpho/VaultV2Allocations';
import { AllocationHistory } from '@/components/morpho/AllocationHistory';
import { VaultV2Caps } from '@/components/morpho/VaultV2Caps';
import { VaultV2Timelocks } from '@/components/morpho/VaultV2Timelocks';
import { VaultV2Parameters } from '@/components/morpho/VaultV2Parameters';
import { VaultV2Pending } from '@/components/morpho/VaultV2Pending';
import { VaultHolders } from '@/components/morpho/VaultHolders';
import { VaultTransactions } from '@/components/morpho/VaultTransactions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';

export default function V2VaultPage() {
  const params = useParams();
  const address = params.address as string;
  // Load all data in parallel - hooks will fetch independently
  // Only block on vault data loading (needed for basic info)
  const { vault, risk, governance, parameters, pending, vaultIsLoading, isError, error } =
    useVaultV2Complete(address);

  // Only block on vault data loading (needed for basic info)
  // Other data (risk, governance) will load in parallel via their own hooks
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
              <Link href="/">Back to overview</Link>
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
              <Link href="/">Back to overview</Link>
            </Button>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  const category = getVaultCategory(vault.name, vault.address);
  const vaultBadge = category === 'prime' ? 'V2 Prime' : category === 'vineyard' ? 'V2 Vineyard' : 'V2';

  const morphoUiUrl = vault.address 
    ? `https://app.morpho.org/base/vault/${vault.address.toLowerCase()}`
    : '#';
  
  // Safe defaults for missing data
  const vaultName = vault.name ?? 'Unknown Vault';
  const vaultSymbol = vault.symbol ?? 'UNKNOWN';
  const vaultAsset = vault.asset ?? 'UNKNOWN';

  return (
    <AppShell
      title="Vault Details"
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="default" className="flex items-center gap-1 bg-blue-600 text-xs sm:text-sm">
            <Shield className="h-3 w-3" /> {vaultBadge}
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
      <div className="space-y-4">
        <Tabs defaultValue="overview" className="space-y-3">
          <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 scrollbar-hide sm:overflow-visible">
            <TabsList className="inline-flex w-auto min-w-full sm:min-w-0 sm:w-full justify-start gap-1">
              <TabsTrigger value="overview" className="sm:flex-1 flex-shrink-0 min-w-fit">Overview</TabsTrigger>
              <TabsTrigger value="risk" className="sm:flex-1 flex-shrink-0 min-w-fit">
                <span className="hidden sm:inline">Risk Management</span>
                <span className="sm:hidden">Risk</span>
              </TabsTrigger>
              <TabsTrigger value="roles" className="sm:flex-1 flex-shrink-0 min-w-fit">Roles</TabsTrigger>
              <TabsTrigger value="adapters" className="sm:flex-1 flex-shrink-0 min-w-fit">Adapters</TabsTrigger>
              <TabsTrigger value="allocations" className="sm:flex-1 flex-shrink-0 min-w-fit">Allocations</TabsTrigger>
              <TabsTrigger value="caps" className="sm:flex-1 flex-shrink-0 min-w-fit">Caps</TabsTrigger>
              <TabsTrigger value="parameters" className="sm:flex-1 flex-shrink-0 min-w-fit">Parameters</TabsTrigger>
              <TabsTrigger value="timelocks" className="sm:flex-1 flex-shrink-0 min-w-fit">Timelocks</TabsTrigger>
              <TabsTrigger value="pending" className="sm:flex-1 flex-shrink-0 min-w-fit">Pending</TabsTrigger>
            </TabsList>
          </div>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-4">
            <VaultOverviewPanel
              vault={vault}
              morphoUiUrl={morphoUiUrl}
              vaultName={vaultName}
              vaultSymbol={vaultSymbol}
              vaultAsset={vaultAsset}
            />

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

          {/* Risk Management Tab */}
          <TabsContent value="risk" className="space-y-4">
            <VaultRiskV2 vaultAddress={vault.address} preloadedData={risk} />
          </TabsContent>

          {/* Roles Tab */}
          <TabsContent value="roles">
            <VaultV2Roles vaultAddress={vault.address} preloadedData={governance} />
          </TabsContent>

          {/* Adapters Tab */}
          <TabsContent value="adapters">
            <VaultV2Adapters vaultAddress={vault.address} preloadedData={governance} />
          </TabsContent>

          {/* Allocations Tab */}
          <TabsContent value="allocations" className="space-y-6">
            <VaultV2Allocations
              vaultAddress={vault.address}
              preloadedData={governance}
              preloadedRisk={risk}
            />
            <AllocationHistory
              vaultAddress={vault.address}
              chainId={vault.chainId}
              assetDecimals={vault.assetDecimals}
              assetSymbol={vault.asset}
            />
          </TabsContent>

          {/* Caps Tab */}
          <TabsContent value="caps">
            <VaultV2Caps vaultAddress={vault.address} preloadedData={governance} />
          </TabsContent>

          {/* Parameters Tab */}
          <TabsContent value="parameters">
            <VaultV2Parameters vaultAddress={vault.address} preloadedData={parameters} />
          </TabsContent>

          {/* Timelocks Tab */}
          <TabsContent value="timelocks">
            <VaultV2Timelocks vaultAddress={vault.address} preloadedData={governance} />
          </TabsContent>

          {/* Pending Tab */}
          <TabsContent value="pending">
            <VaultV2Pending
              vaultAddress={vault.address}
              chainId={vault.chainId}
              preloadedData={pending}
            />
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
