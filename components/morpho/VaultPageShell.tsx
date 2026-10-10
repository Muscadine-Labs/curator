'use client';

import Link from 'next/link';
import { useParams, usePathname, useRouter } from 'next/navigation';
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { MoreHorizontal } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useCopyFeedback } from '@/components/CopyFeedbackProvider';
import { CURATOR_MARKET_NETWORKS, getScanUrlForChain } from '@/lib/constants';
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
  const pendingCount = pending?.pending?.length ?? 0;
  const chainName =
    CURATOR_MARKET_NETWORKS.find((network) => network.chainId === vault.chainId)?.name ??
    'Chain';
  const scanUrl = vault.address
    ? `${getScanUrlForChain(vault.chainId)}/address/${vault.address}`
    : '#';
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
        title={vaultName}
        backHref="/vaults"
        backLabel="Vaults"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="text-xs font-normal">
              {chainName}
            </Badge>
            <Badge variant="outline" className="text-xs font-normal">
              {vaultBadge}
            </Badge>
            <VaultMoreMenu
              address={vault.address}
              morphoUrl={morphoUiUrl}
              scanUrl={scanUrl}
            />
          </div>
        }
      >
        <div className="space-y-6">
          <nav className="-mx-4 overflow-x-auto border-b border-slate-200 px-4 dark:border-slate-800 sm:mx-0 sm:px-0">
            <div className="flex w-max min-w-full gap-1">
              {VAULT_NAV_SEGMENTS.filter(
                (item) => item.segment !== 'fee-wrapper' || feeWrapperAddress
              ).map((item) => {
                const href =
                  item.segment === ''
                    ? `/vault/${address}`
                    : `/vault/${address}/${item.segment}`;
                const active = activeSegment === item.segment;
                const count =
                  (item.segment === 'timelocks' || item.segment === 'sentinel') && pendingCount > 0
                    ? pendingCount
                    : 0;
                return (
                  <Link
                    key={item.segment || 'overview'}
                    href={href}
                    className={cn(
                      'inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors',
                      active
                        ? 'border-slate-900 font-medium text-slate-900 dark:border-slate-100 dark:text-slate-100'
                        : 'border-transparent text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                    )}
                  >
                    {item.label}
                    {count > 0 ? (
                      <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-400 px-1 text-[11px] font-semibold text-slate-950">
                        {count}
                      </span>
                    ) : null}
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

function VaultMoreMenu({
  address,
  morphoUrl,
  scanUrl,
}: {
  address: string;
  morphoUrl: string;
  scanUrl: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const { copyToClipboard } = useCopyFeedback();

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    return () => document.removeEventListener('mousedown', onPointer);
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        aria-label="More actions"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <MoreHorizontal className="h-4 w-4" />
      </Button>
      {open ? (
        <div className="absolute right-0 z-20 mt-1 w-52 rounded-lg border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
          <button
            type="button"
            className="block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
            onClick={() => {
              void copyToClipboard(address);
              setOpen(false);
            }}
          >
            Copy address
          </button>
          <a
            href={morphoUrl}
            target="_blank"
            rel="noreferrer"
            className="block rounded-md px-3 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
            onClick={() => setOpen(false)}
          >
            View on Morpho
          </a>
          <a
            href={scanUrl}
            target="_blank"
            rel="noreferrer"
            className="block rounded-md px-3 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
            onClick={() => setOpen(false)}
          >
            View on explorer
          </a>
        </div>
      ) : null}
    </div>
  );
}
