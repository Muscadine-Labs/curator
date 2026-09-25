'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { Lock } from 'lucide-react';
import { AddressBadge } from '@/components/AddressBadge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  CuratorErrorText,
  CuratorKvList,
  CuratorKvRow,
  CuratorPageHeader,
  CuratorPanel,
} from '@/components/morpho/CuratorChrome';
import { VaultHolders } from '@/components/morpho/VaultHolders';
import { VaultTransactions } from '@/components/morpho/VaultTransactions';
import { VaultOverviewHistoryChart } from '@/components/morpho/VaultOverviewHistoryChart';
import { VaultV2Allocations } from '@/components/morpho/VaultV2Allocations';
import { VaultV2Caps } from '@/components/morpho/VaultV2Caps';
import { VaultV2Timelocks } from '@/components/morpho/VaultV2Timelocks';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TokenUsdValue } from '@/components/morpho/TokenUsdValue';
import { useVault } from '@/lib/hooks/useProtocolStats';
import { useVaultV2Governance } from '@/lib/hooks/useVaultV2Governance';
import { useVaultV2Risk } from '@/lib/hooks/useVaultV2Risk';
import { useVaultV2Pending } from '@/lib/hooks/useVaultV2Pending';
import { useVaultV2Gates } from '@/lib/hooks/useVaultV2Gates';
import { getScanUrlForChain } from '@/lib/constants';
import { formatPercentage } from '@/lib/format/number';
import { resolveTokenDisplayProps } from '@/lib/format/asset-decimals';
import { formatMaxRateApr } from '@/lib/morpho/vault-v2-api';
import { vaultGateStatuses } from '@/lib/morpho/vault-v2-gate-state';
import {
  morphoCuratorVaultHref,
  morphoVaultHref,
} from '@/lib/morpho/morpho-app-links';
import { withFeeWrapperLabel } from '@/lib/config/vaults';
import { cn } from '@/lib/utils';

function AddressOrDash({ address, scanUrl }: { address: string | null; scanUrl?: string }) {
  if (!address) return <span className="font-normal text-muted-foreground">—</span>;
  return <AddressBadge address={address} scanUrl={scanUrl} truncate label="auto" />;
}

function AddressList({
  addresses,
  scanUrl,
}: {
  addresses: string[];
  scanUrl?: string;
}) {
  if (addresses.length === 0) {
    return <span className="font-normal text-muted-foreground">None</span>;
  }
  return (
    <div className="flex flex-col items-start gap-1.5 sm:items-end">
      {addresses.map((addr) => (
        <AddressBadge key={addr} address={addr} scanUrl={scanUrl} truncate label="auto" />
      ))}
    </div>
  );
}

function CompactStat({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-border/70 bg-muted/20 px-3 py-2.5">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <div className="mt-0.5 text-base font-semibold leading-tight tabular-nums text-foreground">
        {children}
      </div>
      {hint ? (
        <div className="mt-0.5 text-[11px] leading-tight text-muted-foreground">{hint}</div>
      ) : null}
    </div>
  );
}

export function FeeWrapperPanel({
  underlyingAddress,
  feeWrapperAddress,
  underlyingName,
}: {
  underlyingAddress: string;
  feeWrapperAddress: string | null;
  underlyingName: string;
}) {
  const router = useRouter();

  useEffect(() => {
    if (!feeWrapperAddress) {
      router.replace(`/vault/${underlyingAddress}`);
    }
  }, [feeWrapperAddress, underlyingAddress, router]);

  const wrapperQuery = useVault(feeWrapperAddress ?? '');
  const governanceQuery = useVaultV2Governance(feeWrapperAddress);
  const riskQuery = useVaultV2Risk(feeWrapperAddress);
  const gatesQuery = useVaultV2Gates(feeWrapperAddress);
  const pendingQuery = useVaultV2Pending(feeWrapperAddress);
  const [section, setSection] = useState('overview');

  if (!feeWrapperAddress) return null;

  if (wrapperQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-lg" />
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-56 w-full rounded-xl" />
          <Skeleton className="h-56 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  if (wrapperQuery.isError || !wrapperQuery.data) {
    return (
      <div className="space-y-4">
        <CuratorPageHeader title="Fee wrapper" />
        <CuratorErrorText>
          Failed to load fee wrapper:{' '}
          {wrapperQuery.error instanceof Error ? wrapperQuery.error.message : 'Unknown error'}
        </CuratorErrorText>
      </div>
    );
  }

  const wrapper = wrapperQuery.data;
  const governance = governanceQuery.data;
  const scanUrl = getScanUrlForChain(wrapper.chainId);
  const assetSymbol = wrapper.asset ?? 'UNKNOWN';
  const { chainDecimals, displayDecimals } = resolveTokenDisplayProps(
    assetSymbol,
    wrapper.assetDecimals
  );
  const wrapperName = withFeeWrapperLabel(wrapper.name ?? 'Fee wrapper', wrapper.address);
  const perfFee =
    wrapper.parameters?.performanceFeePercent ??
    (wrapper.parameters?.performanceFeeBps != null
      ? wrapper.parameters.performanceFeeBps / 100
      : null);
  const mgmtFee = wrapper.analytics?.managementFeePercent ?? null;
  const morphoAppUrl = morphoVaultHref(wrapper.address, wrapper.chainId);
  const morphoCuratorUrl = morphoCuratorVaultHref(wrapper.address, wrapper.chainId);
  const gateRows = vaultGateStatuses(gatesQuery.data, governance?.timelocks ?? []);
  const pendingCount = pendingQuery.data?.pending?.length ?? 0;

  return (
    <div className="space-y-6">
      <CuratorPageHeader
        title="Fee wrapper"
        description={
          <span>
            Public Morpho wrapper on {underlyingName}. Deposits allocate only to this
            underlying strategy.{' '}
            <a
              href={morphoAppUrl}
              target="_blank"
              rel="noreferrer"
              className="text-foreground underline-offset-2 hover:underline"
            >
              Open on Morpho ↗
            </a>
          </span>
        }
        actions={
          <Button variant="outline" size="sm" asChild>
            <a href={morphoCuratorUrl} target="_blank" rel="noreferrer">
              Claim fees ↗
            </a>
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <CompactStat label="TVL" hint="Total deposits in wrapper">
          <TokenUsdValue
            underlying={wrapper.analytics?.totalAssetsUnderlying ?? wrapper.totalAssetsUnderlying}
            usd={wrapper.tvl}
            assetSymbol={assetSymbol}
            chainDecimals={chainDecimals}
            displayDecimals={displayDecimals}
            compactUsd
            align="left"
          />
        </CompactStat>
        <CompactStat label="Liquidity" hint="Withdrawable from wrapper">
          <TokenUsdValue
            underlying={wrapper.analytics?.liquidityUnderlying ?? wrapper.liquidityUnderlying}
            usd={wrapper.analytics?.liquidityUsd ?? wrapper.liquidityUsd}
            assetSymbol={assetSymbol}
            chainDecimals={chainDecimals}
            displayDecimals={displayDecimals}
            compactUsd
            align="left"
          />
        </CompactStat>
        <CompactStat label="Users" hint="Public depositors">
          {wrapper.depositors != null ? wrapper.depositors.toLocaleString() : '—'}
        </CompactStat>
      </div>

      <Tabs value={section} onValueChange={setSection}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="allocation">Allocation</TabsTrigger>
          <TabsTrigger value="caps">
            {pendingCount > 0 ? `Caps / timelocks (${pendingCount})` : 'Caps / timelocks'}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-2">
        <CuratorPanel title="Overview">
          <CuratorKvList>
            <CuratorKvRow label="Name" description="The fee wrapper name">
              {wrapperName}
            </CuratorKvRow>
            <CuratorKvRow label="Symbol" description="The fee wrapper symbol">
              {wrapper.symbol ?? '—'}
            </CuratorKvRow>
            <CuratorKvRow label="Address" description="Onchain wrapper contract">
              <AddressBadge address={wrapper.address} scanUrl={`${scanUrl}/address/${wrapper.address}`} truncate />
            </CuratorKvRow>
            <CuratorKvRow label="Deposit token" description="Token deposited into wrapper">
              {assetSymbol}
            </CuratorKvRow>
          </CuratorKvList>
        </CuratorPanel>

        <CuratorPanel title="Fees">
          <CuratorKvList>
            <CuratorKvRow
              label="Performance fee"
              description="Percentage of interest earned by the vault, charged on harvest"
            >
              {perfFee != null ? formatPercentage(perfFee, 2) : '0%'}
            </CuratorKvRow>
            <CuratorKvRow
              label="Performance fee recipient"
              description="Wallet that receives performance fee payments"
            >
              <AddressOrDash
                address={governance?.performanceFeeRecipient ?? null}
                scanUrl={
                  governance?.performanceFeeRecipient
                    ? `${scanUrl}/address/${governance.performanceFeeRecipient}`
                    : undefined
                }
              />
            </CuratorKvRow>
            <CuratorKvRow
              label="Management fee"
              description="Annual fee charged continuously on total vault assets"
            >
              {mgmtFee != null ? formatPercentage(mgmtFee, 2) : '0%'}
            </CuratorKvRow>
            <CuratorKvRow
              label="Management fee recipient"
              description="Wallet that receives management fee payments"
            >
              <AddressOrDash
                address={governance?.managementFeeRecipient ?? null}
                scanUrl={
                  governance?.managementFeeRecipient
                    ? `${scanUrl}/address/${governance.managementFeeRecipient}`
                    : undefined
                }
              />
            </CuratorKvRow>
          </CuratorKvList>
        </CuratorPanel>

        <CuratorPanel title="Underlying vault">
          <CuratorKvList>
            <CuratorKvRow label="Name" description="The Morpho vault being wrapped">
              {underlyingName}
            </CuratorKvRow>
            <CuratorKvRow label="Address" description="Onchain vault contract">
              <AddressBadge
                address={underlyingAddress}
                scanUrl={`${scanUrl}/address/${underlyingAddress}`}
                truncate
              />
            </CuratorKvRow>
          </CuratorKvList>
        </CuratorPanel>

        <CuratorPanel title="Roles">
          {governanceQuery.isLoading && !governance ? (
            <div className="space-y-3 p-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <CuratorKvList>
              <CuratorKvRow label="Owner" description="Assigns and manages vault roles">
                <AddressOrDash address={governance?.owner ?? null} />
              </CuratorKvRow>
              <CuratorKvRow label="Curator" description="Configures vault parameters and risk">
                <AddressOrDash address={governance?.curator ?? null} />
              </CuratorKvRow>
              <CuratorKvRow label="Allocators" description="Authorized to rebalance allocations">
                <AddressList addresses={governance?.allocators ?? []} />
              </CuratorKvRow>
              <CuratorKvRow label="Sentinels" description="Can deallocate and decrease caps">
                <AddressList addresses={governance?.sentinels ?? []} />
              </CuratorKvRow>
            </CuratorKvList>
          )}
        </CuratorPanel>

        <CuratorPanel title="Gates">
          <CuratorKvList>
            {gateRows.map((gate) => (
              <CuratorKvRow key={gate.key} label={gate.label} description={gate.description}>
                <span className="inline-flex items-center justify-end gap-1.5">
                  {gate.variant === 'abdicated' ? (
                    <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                  ) : null}
                  <span
                    className={cn(
                      gate.variant === 'abdicated' &&
                        'text-amber-700 dark:text-amber-400',
                      gate.variant === 'none' && 'text-muted-foreground'
                    )}
                  >
                    {gate.variant === 'set' && gate.address ? (
                      <AddressBadge address={gate.address} truncate />
                    ) : (
                      gate.statusLabel
                    )}
                  </span>
                </span>
              </CuratorKvRow>
            ))}
          </CuratorKvList>
        </CuratorPanel>

        <CuratorPanel
          title="Max rate"
          description="Caps how fast the wrapper's assets can grow to avoid yield spikes."
        >
          <p className="px-4 py-3 text-lg font-semibold tabular-nums">
            {formatMaxRateApr(governance?.maxRate)}
          </p>
        </CuratorPanel>
      </div>

      <VaultHolders
        vaultAddress={wrapper.address}
        chainId={wrapper.chainId}
        assetDecimals={wrapper.assetDecimals}
        assetSymbol={assetSymbol}
        pageSize={10}
        collapsible
        defaultOpen={false}
      />

      <VaultTransactions
        vaultAddress={wrapper.address}
        chainId={wrapper.chainId}
        assetDecimals={wrapper.assetDecimals}
        assetSymbol={assetSymbol}
        pageSize={10}
        collapsible
        defaultOpen={false}
      />

      <VaultOverviewHistoryChart
        vaultAddress={wrapper.address}
        collapsible
        defaultOpen={false}
      />
        </TabsContent>

        <TabsContent value="allocation" className="space-y-6">
          {/* Allocations renders the liquidity adapter panel and its own error state. */}
          <VaultV2Allocations
            vaultAddress={wrapper.address}
            chainId={wrapper.chainId}
            preloadedData={governance}
            preloadedRisk={riskQuery.data}
            liquidityAdapterVariant="vault-or-idle"
          />
        </TabsContent>

        <TabsContent value="caps" className="space-y-6">
          <VaultV2Caps
            vaultAddress={wrapper.address}
            chainId={wrapper.chainId}
            preloadedData={governance}
            preloadedRisk={riskQuery.data}
            preloadedPending={pendingQuery.data}
            assetSymbol={assetSymbol}
            assetDecimals={wrapper.assetDecimals}
            totalAssetsUnderlying={
              wrapper.analytics?.totalAssetsUnderlying ?? wrapper.totalAssetsUnderlying
            }
          />
          <VaultV2Timelocks vaultAddress={wrapper.address} preloadedData={governance} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
