'use client';

import Link from 'next/link';
import { useParams, usePathname, useRouter } from 'next/navigation';
import {
  createContext,
  useContext,
  useEffect,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Shield } from 'lucide-react';
import { getScanUrlForChain, getScanNameForChain } from '@/lib/constants';
import { useVaultV2Complete } from '@/lib/hooks/useVaultV2Complete';
import { vaultV2GovernanceQueryKey } from '@/lib/hooks/useVaultV2Governance';
import { vaultV2GatesQueryKey } from '@/lib/hooks/useVaultV2Gates';
import {
  getFeeWrapperForUnderlying,
  getVaultByAddress,
  getVaultCategory,
  isFeeWrapperVault,
  withFeeWrapperLabel,
} from '@/lib/config/vaults';
import { morphoVaultHref } from '@/lib/morpho/morpho-app-links';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { VaultDetail } from '@/lib/hooks/useProtocolStats';
import type { VaultV2GovernanceResponse } from '@/app/api/vaults/[id]/governance/route';
import type { V2VaultRiskResponse } from '@/app/api/vaults/[id]/risk/route';
import type { VaultV2PendingResponse } from '@/app/api/vaults/[id]/pending/route';

const CATEGORY_BADGE: Record<string, string> = {
  prime: 'V2 Prime',
  vineyard: 'V2 Vineyard',
  frontier: 'V2 Frontier',
  test: 'V2 Test',
};

/** Morpho-style vault segments (path under `/vault/[address]/…`). */
export const VAULT_NAV_SEGMENTS = [
  { segment: '', label: 'Overview', refreshOnEnter: true },
  { segment: 'fee-wrapper', label: 'Fee wrapper', refreshOnEnter: true },
  { segment: 'allocation', label: 'Allocation', refreshOnEnter: true },
  { segment: 'caps', label: 'Caps', refreshOnEnter: true },
  { segment: 'risk', label: 'Risk', refreshOnEnter: false },
  { segment: 'timelocks', label: 'Timelocks', refreshOnEnter: false },
  { segment: 'sentinel', label: 'Sentinel', refreshOnEnter: true },
] as const;

export type VaultPageData = {
  address: string;
  vault: VaultDetail;
  risk: V2VaultRiskResponse | null | undefined;
  governance: VaultV2GovernanceResponse | null | undefined;
  pending: VaultV2PendingResponse | null | undefined;
  morphoUiUrl: string;
  emergencyActionsUrl: string;
  vaultName: string;
  vaultSymbol: string;
  vaultAsset: string;
  /** Wrapper vault address when this strategy vault has a fee wrapper. */
  feeWrapperAddress: string | null;
};

const VaultPageContext = createContext<VaultPageData | null>(null);

export function useVaultPage(): VaultPageData {
  const ctx = useContext(VaultPageContext);
  if (!ctx) {
    throw new Error('useVaultPage must be used under VaultPageShell');
  }
  return ctx;
}

function vaultSegmentFromPath(pathname: string, address: string): string {
  const base = `/vault/${address}`.toLowerCase();
  const path = pathname.toLowerCase();
  if (path === base || path === `${base}/`) return '';
  const rest = path.startsWith(`${base}/`) ? path.slice(base.length + 1) : '';
  return rest.split('/')[0] ?? '';
}

export function VaultPageShell({ children }: { children: ReactNode }) {
  const params = useParams();
  const address = params.address as string;
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const requestedCfg = getVaultByAddress(address);
  const wrapperRedirectHref =
    requestedCfg && isFeeWrapperVault(requestedCfg) && requestedCfg.underlyingAddress
      ? `/vault/${requestedCfg.underlyingAddress}/fee-wrapper`
      : null;
  const { vault, risk, governance, pending, vaultIsLoading, isError, error } =
    useVaultV2Complete(wrapperRedirectHref ? null : address);

  const activeSegment = vaultSegmentFromPath(pathname, address);
  const feeWrapperAddress = getFeeWrapperForUnderlying(address)?.address ?? null;

  useEffect(() => {
    if (wrapperRedirectHref) {
      router.replace(wrapperRedirectHref);
    }
  }, [router, wrapperRedirectHref]);

  useEffect(() => {
    if (activeSegment === 'fee-wrapper' && feeWrapperAddress) {
      void queryClient.refetchQueries({ queryKey: ['vault', feeWrapperAddress] });
      void queryClient.refetchQueries({
        queryKey: vaultV2GovernanceQueryKey(feeWrapperAddress),
      });
      void queryClient.refetchQueries({
        queryKey: vaultV2GatesQueryKey(feeWrapperAddress),
      });
      return;
    }
    const meta = VAULT_NAV_SEGMENTS.find((s) => s.segment === activeSegment);
    if (!meta?.refreshOnEnter) return;
    void queryClient.refetchQueries({ queryKey: vaultV2GovernanceQueryKey(address) });
    void queryClient.refetchQueries({ queryKey: ['vault-v2-risk', address] });
  }, [activeSegment, address, feeWrapperAddress, queryClient]);

  if (wrapperRedirectHref || vaultIsLoading) {
    return (
      <AppShell
        title="Loading vault..."
        description="Fetching vault data"
        backHref="/vaults"
        backLabel="Vaults"
      >
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
      <AppShell
        title="Error loading vault"
        description={error instanceof Error ? error.message : 'Failed to load vault data'}
        backHref="/vaults"
        backLabel="Vaults"
      >
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
  const vaultBadge = isFeeWrapperVault(vault)
    ? `${CATEGORY_BADGE[category] ?? 'V2'} Wrapper`
    : (CATEGORY_BADGE[category] ?? 'V2');
  const hasPending = (pending?.pending?.length ?? 0) > 0;
  const morphoUiUrl = vault.address
    ? morphoVaultHref(vault.address, vault.chainId)
    : '#';
  const emergencyActionsUrl = vault.address
    ? `https://curator.morpho.org/vaults/${vault.chainId}/${vault.address}/emergency-actions`
    : '#';
  const vaultName = withFeeWrapperLabel(vault.name ?? 'Unknown Vault', vault.address);
  const vaultSymbol = vault.symbol ?? 'UNKNOWN';
  const vaultAsset = vault.asset ?? 'UNKNOWN';

  const data: VaultPageData = {
    address,
    vault,
    risk,
    governance,
    pending,
    morphoUiUrl,
    emergencyActionsUrl,
    vaultName,
    vaultSymbol,
    vaultAsset,
    feeWrapperAddress,
  };

  return (
    <VaultPageContext.Provider value={data}>
      <AppShell
        title="Vault Details"
        backHref="/vaults"
        backLabel="Vaults"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="default"
              className="flex items-center gap-1 bg-blue-600 text-xs sm:text-sm"
            >
              <Shield className="h-3 w-3" /> {vaultBadge}
            </Badge>
            <Button variant="outline" size="sm" asChild className="text-xs sm:text-sm">
              <a
                href={
                  vault.address
                    ? `${getScanUrlForChain(vault.chainId)}/address/${vault.address}`
                    : '#'
                }
                target="_blank"
                rel="noreferrer"
              >
                <span className="hidden sm:inline">
                  View on {getScanNameForChain(vault.chainId)}
                </span>
                <span className="sm:hidden">{getScanNameForChain(vault.chainId)}</span>
              </a>
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <nav className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 scrollbar-hide sm:overflow-visible">
            <div className="inline-flex w-auto min-w-full sm:min-w-0 sm:w-full justify-start gap-1 rounded-lg bg-muted p-1">
              {VAULT_NAV_SEGMENTS.filter(
                (item) => item.segment !== 'fee-wrapper' || feeWrapperAddress
              ).map((item) => {
                const href =
                  item.segment === ''
                    ? `/vault/${address}`
                    : `/vault/${address}/${item.segment}`;
                const active = activeSegment === item.segment;
                const label =
                  item.segment === 'caps' && hasPending
                    ? `Caps (${pending!.pending.length})`
                    : item.label;
                return (
                  <Link
                    key={item.segment || 'overview'}
                    href={href}
                    className={cn(
                      'sm:flex-1 flex-shrink-0 min-w-fit inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                      active
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {label}
                  </Link>
                );
              })}
            </div>
          </nav>

          <div className="space-y-4">{children}</div>
        </div>
      </AppShell>
    </VaultPageContext.Provider>
  );
}
