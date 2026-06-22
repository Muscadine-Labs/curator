'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Shield } from 'lucide-react';
import { getScanUrlForChain, getScanNameForChain } from '@/lib/constants';
import { useVaultV2Complete } from '@/lib/hooks/useVaultV2Complete';
import { getVaultCategory } from '@/lib/config/vaults';
import { AppShell } from '@/components/layout/AppShell';
import { VaultOverviewPanel } from '@/components/morpho/VaultOverviewPanel';
import { VaultV2Roles } from '@/components/morpho/VaultV2Roles';
import { VaultV2Adapters } from '@/components/morpho/VaultV2Adapters';
import { VaultV2Allocations } from '@/components/morpho/VaultV2Allocations';
import { VaultV2Caps } from '@/components/morpho/VaultV2Caps';
import { VaultV2Timelocks } from '@/components/morpho/VaultV2Timelocks';
import { VaultV2Sentinel } from '@/components/morpho/VaultV2Sentinel';
import { AllocationHistory } from '@/components/morpho/AllocationHistory';
import { VaultHolders } from '@/components/morpho/VaultHolders';
import { VaultTransactions } from '@/components/morpho/VaultTransactions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';

const CATEGORY_BADGE: Record<string, string> = {
  prime: 'V2 Prime',
  vineyard: 'V2 Vineyard',
  frontier: 'V2 Frontier',
  test: 'V2 Test',
};

export default function V2VaultPage() {
  const params = useParams();
  const address = params.address as string;
  const { vault, risk, governance, pending, vaultIsLoading, isError, error } =
    useVaultV2Complete(address);

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

  const category = getVaultCategory(vault.name, vault.address);
  const vaultBadge = CATEGORY_BADGE[category] ?? 'V2';
  const hasPending = (pending?.pending?.length ?? 0) > 0;

  const morphoUiUrl = vault.address
    ? `https://app.morpho.org/base/vault/${vault.address.toLowerCase()}`
    : '#';

  const emergencyActionsUrl = vault.address
    ? `https://curator.morpho.org/vaults/${vault.chainId}/${vault.address}/emergency-actions`
    : '#';

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
              <TabsTrigger value="roles" className="sm:flex-1 flex-shrink-0 min-w-fit">Roles</TabsTrigger>
              <TabsTrigger value="adapters" className="sm:flex-1 flex-shrink-0 min-w-fit">Adapters</TabsTrigger>
              <TabsTrigger value="caps" className="sm:flex-1 flex-shrink-0 min-w-fit">
                Caps{hasPending ? ` (${pending!.pending.length})` : ''}
              </TabsTrigger>
              <TabsTrigger value="timelocks" className="sm:flex-1 flex-shrink-0 min-w-fit">Timelocks</TabsTrigger>
              <TabsTrigger value="allocations" className="sm:flex-1 flex-shrink-0 min-w-fit">Allocation</TabsTrigger>
              <TabsTrigger value="sentinel" className="sm:flex-1 flex-shrink-0 min-w-fit">Sentinel</TabsTrigger>
              <TabsTrigger value="emergency" className="sm:flex-1 flex-shrink-0 min-w-fit">Emergency</TabsTrigger>
            </TabsList>
          </div>

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

            <VaultTransactions
              vaultAddress={vault.address}
              chainId={vault.chainId}
              assetDecimals={vault.assetDecimals}
              assetSymbol={vault.asset}
            />
          </TabsContent>

          <TabsContent value="roles">
            <VaultV2Roles vaultAddress={vault.address} preloadedData={governance} />
          </TabsContent>

          <TabsContent value="adapters">
            <VaultV2Adapters
              vaultAddress={vault.address}
              preloadedData={governance}
              preloadedRisk={risk}
              assetSymbol={vault.asset}
              assetDecimals={vault.assetDecimals}
            />
          </TabsContent>

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

          <TabsContent value="caps">
            <VaultV2Caps
              vaultAddress={vault.address}
              chainId={vault.chainId}
              preloadedData={governance}
              preloadedRisk={risk}
              preloadedPending={pending}
              assetSymbol={vault.asset}
              assetDecimals={vault.assetDecimals}
            />
          </TabsContent>

          <TabsContent value="timelocks">
            <VaultV2Timelocks vaultAddress={vault.address} preloadedData={governance} />
          </TabsContent>

          <TabsContent value="sentinel">
            <VaultV2Sentinel
              vaultAddress={vault.address}
              chainId={vault.chainId}
              preloadedGovernance={governance}
              preloadedRisk={risk}
              preloadedPending={pending}
              assetSymbol={vault.asset}
              assetDecimals={vault.assetDecimals}
            />
          </TabsContent>

          <TabsContent value="emergency" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Emergency Actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Execute timelocked emergency actions for this vault on Morpho Curator.
                </p>
                <div>
                  <Button variant="outline" asChild>
                    <a href={emergencyActionsUrl} target="_blank" rel="noopener noreferrer">
                      Open Emergency Actions
                    </a>
                  </Button>
                </div>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  <a
                    href={emergencyActionsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 underline break-all"
                  >
                    {emergencyActionsUrl}
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
