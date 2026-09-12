'use client';

import { Badge } from '@/components/ui/badge';
import { AddressBadge } from '@/components/AddressBadge';
import { formatPercentage } from '@/lib/format/number';
import { resolveTokenDisplayProps } from '@/lib/format/asset-decimals';
import { formatMaxRateApr } from '@/lib/morpho/vault-v2-api';
import type { VaultDetail } from '@/lib/hooks/useProtocolStats';
import type { VaultV2GovernanceResponse } from '@/app/api/vaults/[id]/governance/route';
import { VaultOverviewHistoryChart } from '@/components/morpho/VaultOverviewHistoryChart';
import { TokenUsdValue } from '@/components/morpho/TokenUsdValue';
import { VaultV2Roles } from '@/components/morpho/VaultV2Roles';
import { VaultV2GatesRead } from '@/components/morpho/VaultV2GatesRead';
import { VaultV2Adapters } from '@/components/morpho/VaultV2Adapters';
import { VaultHolders } from '@/components/morpho/VaultHolders';
import { VaultTransactions } from '@/components/morpho/VaultTransactions';
import {
  CuratorKvList,
  CuratorKvRow,
  CuratorPageHeader,
  CuratorPanel,
} from '@/components/morpho/CuratorChrome';

interface VaultOverviewPanelProps {
  vault: VaultDetail;
  morphoUiUrl: string;
  vaultName: string;
  vaultSymbol: string;
  vaultAsset: string;
  governance?: VaultV2GovernanceResponse | null;
  risk?: import('@/app/api/vaults/[id]/risk/route').V2VaultRiskResponse | null;
}

function warningBadgeClass(level: string): string {
  const l = level.toUpperCase();
  if (l === 'RED') return 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400';
  if (l === 'YELLOW') return 'border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-400';
  return 'border-emerald-500/30 text-emerald-700 dark:text-emerald-400';
}

export function VaultOverviewPanel({
  vault,
  morphoUiUrl,
  vaultName,
  vaultSymbol,
  vaultAsset,
  governance,
  risk,
}: VaultOverviewPanelProps) {
  const analytics = vault.analytics;
  const warnings = vault.warnings ?? [];
  const { chainDecimals, displayDecimals } = resolveTokenDisplayProps(
    vaultAsset,
    vault.assetDecimals
  );
  const perfFee =
    vault.parameters?.performanceFeePercent ??
    (vault.parameters?.performanceFeeBps != null
      ? vault.parameters.performanceFeeBps / 100
      : null);
  const mgmtFee = analytics?.managementFeePercent ?? null;

  const warningActions =
    warnings.length > 0 ? (
      <div className="flex max-w-md flex-wrap justify-end gap-1">
        {warnings.slice(0, 4).map((w, i) => (
          <Badge
            key={`${w.type}-${i}`}
            variant="outline"
            className={`text-[10px] font-normal ${warningBadgeClass(w.level)}`}
          >
            {w.type.replace(/_/g, ' ')}
          </Badge>
        ))}
      </div>
    ) : undefined;

  return (
    <div className="space-y-6">
      <CuratorPageHeader
        title={vaultName}
        description={
          <span className="inline-flex flex-wrap items-center gap-1.5">
            <a
              href={morphoUiUrl}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-muted-foreground hover:text-foreground hover:underline"
            >
              Open on Morpho ↗
            </a>
            <span aria-hidden>·</span>
            <span>{vaultSymbol}</span>
            <span aria-hidden>·</span>
            <span>{vaultAsset}</span>
          </span>
        }
        actions={warningActions}
      />

      <CuratorPanel title="Metrics">
        <CuratorKvList>
          <CuratorKvRow
            label="Total assets"
            description="Total assets currently held in this vault"
          >
            <TokenUsdValue
              underlying={analytics?.totalAssetsUnderlying}
              usd={vault.tvl}
              assetSymbol={vaultAsset}
              chainDecimals={chainDecimals}
              displayDecimals={displayDecimals}
            />
          </CuratorKvRow>
          <CuratorKvRow
            label="Liquidity"
            description="Morpho's withdrawable estimate across allocations"
          >
            <TokenUsdValue
              underlying={analytics?.liquidityUnderlying}
              usd={analytics?.liquidityUsd}
              assetSymbol={vaultAsset}
              chainDecimals={chainDecimals}
              displayDecimals={displayDecimals}
            />
          </CuratorKvRow>
          <CuratorKvRow
            label="Idle"
            description="Cash held in the vault (not deployed to strategies)"
          >
            <TokenUsdValue
              underlying={analytics?.idleAssetsUnderlying}
              usd={analytics?.idleAssetsUsd}
              assetSymbol={vaultAsset}
              chainDecimals={chainDecimals}
              displayDecimals={displayDecimals}
            />
          </CuratorKvRow>
          <CuratorKvRow
            label="APY"
            description="Instant APY weighted across all allocations, including idle liquidity"
          >
            {vault.apy != null ? formatPercentage(vault.apy, 2) : '—'}
          </CuratorKvRow>
          {analytics?.deployedPercent != null ? (
            <CuratorKvRow
              label="Deployed"
              description="Share of TVL currently allocated to strategies"
            >
              {`${analytics.deployedPercent.toFixed(1)}%`}
            </CuratorKvRow>
          ) : null}
        </CuratorKvList>
      </CuratorPanel>

      <VaultHolders
        vaultAddress={vault.address}
        chainId={vault.chainId}
        assetDecimals={vault.assetDecimals}
        assetSymbol={vaultAsset}
        pageSize={10}
        collapsible
        defaultOpen={false}
      />

      <VaultTransactions
        vaultAddress={vault.address}
        chainId={vault.chainId}
        assetDecimals={vault.assetDecimals}
        assetSymbol={vaultAsset}
        pageSize={10}
        collapsible
        defaultOpen={false}
      />

      <VaultOverviewHistoryChart
        vaultAddress={vault.address}
        collapsible
        defaultOpen={false}
      />

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
            description="Wallet that receives the performance fee payments"
          >
            {governance?.performanceFeeRecipient ? (
              <AddressBadge address={governance.performanceFeeRecipient} truncate />
            ) : (
              '—'
            )}
          </CuratorKvRow>
          <CuratorKvRow
            label="Management fee"
            description="Annual fee charged continuously on total vault assets"
          >
            {mgmtFee != null ? formatPercentage(mgmtFee, 2) : '0%'}
          </CuratorKvRow>
          <CuratorKvRow
            label="Management fee recipient"
            description="Wallet that receives the management fee payments"
          >
            {governance?.managementFeeRecipient ? (
              <AddressBadge address={governance.managementFeeRecipient} truncate />
            ) : (
              '—'
            )}
          </CuratorKvRow>
        </CuratorKvList>
      </CuratorPanel>

      <CuratorPanel
        title="Max rate"
        description="Caps how fast the vault's assets can grow to avoid yield spikes."
      >
        <p className="px-4 py-3 text-lg font-semibold tabular-nums">
          {formatMaxRateApr(governance?.maxRate)}
        </p>
      </CuratorPanel>

      <VaultV2Roles vaultAddress={vault.address} preloadedData={governance} />

      <VaultV2GatesRead vaultAddress={vault.address} timelocks={governance?.timelocks} />

      <VaultV2Adapters
        vaultAddress={vault.address}
        preloadedData={governance}
        preloadedRisk={risk}
        assetSymbol={vaultAsset}
        assetDecimals={vault.assetDecimals}
      />
    </div>
  );
}
