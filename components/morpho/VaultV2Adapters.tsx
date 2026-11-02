'use client';

import { useMemo } from 'react';
import { Zap } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { AddressBadge } from '@/components/AddressBadge';
import {
  CuratorEmptyText,
  CuratorErrorText,
  CuratorPanel,
} from '@/components/morpho/CuratorChrome';
import { isAdapterCap } from '@/lib/morpho/cap-utils';
import { formatCapCompactAmount, formatCapRelative } from '@/lib/morpho/v2-cap-format';
import { estimateRawFromUsd } from '@/lib/format/allocation-display';
import { adapterAllocationRaw, summarizeAdapter } from '@/lib/morpho/vault-adapter-summary';
import { useVaultV2Governance } from '@/lib/hooks/useVaultV2Governance';
import { useVaultV2Risk } from '@/lib/hooks/useVaultV2Risk';
import { formatPercentage, formatRawTokenAmount, formatUSD } from '@/lib/format/number';
import {
  getTokenDisplayDecimals,
  resolveAssetDecimals,
} from '@/lib/format/asset-decimals';
import { formatForceDeallocatePenaltyWad } from '@/lib/morpho/vault-v2-api';
import {
  underlyingVaultLabel,
  isMorphoVaultV2Adapter,
  UNDERLYING_VAULT_FALLBACK,
  vaultAdapterProduct,
} from '@/lib/morpho/vault-v2-adapter';
import {
  getConfiguredVaultDisplayName,
  getVaultByAddress,
  resolveUnderlyingVaultAddress,
} from '@/lib/config/vaults';
import { cn } from '@/lib/utils';
import type { AdapterInfo, VaultV2GovernanceResponse } from '@/app/api/vaults/[id]/governance/route';
import type { V2VaultRiskResponse } from '@/app/api/vaults/[id]/risk/route';

interface VaultV2AdaptersProps {
  vaultAddress: string;
  preloadedData?: VaultV2GovernanceResponse | null;
  preloadedRisk?: V2VaultRiskResponse | null;
  assetSymbol?: string | null;
  assetDecimals?: number | null;
}

export function VaultV2Adapters({
  vaultAddress,
  preloadedData,
  preloadedRisk,
  assetSymbol,
  assetDecimals,
}: VaultV2AdaptersProps) {
  const { data: fetchedGov, isLoading: govLoading, error: govError } = useVaultV2Governance(vaultAddress);
  const { data: fetchedRisk, isLoading: riskLoading } = useVaultV2Risk(vaultAddress, {
    initialData: preloadedRisk ?? undefined,
  });
  const data = fetchedGov ?? preloadedData;
  const risk = fetchedRisk ?? preloadedRisk;

  const liquidityAdapterAddress = data?.liquidityAdapter?.address?.toLowerCase();

  const adapters = useMemo<AdapterInfo[]>(() => {
    if (!data?.adapters) return [];
    return [...data.adapters]
      .filter((a) => !a.type.includes('MetaMorpho'))
      .sort((a, b) => (b.assetsUsd ?? 0) - (a.assetsUsd ?? 0));
  }, [data?.adapters]);

  // Deployable idle is the vault's own on-chain asset balance (risk overlay);
  // GraphQL idle lags right after a rebalance and is only the fallback.
  const idleRaw = risk?.idleAssets ?? data?.idleAssets ?? null;
  const idleUsd = risk?.idleAssetsUsd ?? data?.idleAssetsUsd ?? 0;

  const totalUsd = useMemo(() => {
    const strat = adapters.reduce((s, a) => s + (a.assetsUsd ?? 0), 0);
    return idleUsd + strat;
  }, [idleUsd, adapters]);

  const chainDecimals = resolveAssetDecimals(assetSymbol ?? undefined, assetDecimals ?? undefined);
  const displayDecimals = getTokenDisplayDecimals(assetSymbol ?? undefined, chainDecimals);

  if ((!preloadedData && govLoading) || (!preloadedRisk && riskLoading)) {
    return (
      <CuratorPanel title="Adapters">
        <div className="space-y-3 p-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </CuratorPanel>
    );
  }

  if (govError || !data) {
    return (
      <CuratorPanel title="Adapters">
        <div className="px-4 py-3">
          <CuratorErrorText>
            Failed to load adapters: {govError instanceof Error ? govError.message : 'Unknown error'}
          </CuratorErrorText>
        </div>
      </CuratorPanel>
    );
  }

  const th = 'whitespace-nowrap px-3 py-2 text-left text-xs font-medium text-muted-foreground';
  const td = 'whitespace-nowrap border-t border-border/60 px-3 py-2 align-top';

  return (
    <CuratorPanel
      title="Adapters"
      description="Where vault assets are deployed. Liquidity is what can be withdrawn from each adapter right now."
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2 text-xs text-muted-foreground">
        <span>Liquidity adapter (deposits and withdrawals):</span>
        {data.liquidityAdapter?.address ? (
          <AddressBadge address={data.liquidityAdapter.address} truncate />
        ) : (
          <span>Not set</span>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr>
              <th className={th}>Adapter</th>
              <th className={th}>Underlying</th>
              <th className={`${th} text-right`}>Allocation / %</th>
              <th className={`${th} text-right`}>Absolute / Relative cap</th>
              <th className={`${th} text-right`}>Liquidity</th>
              <th
                className={`${th} text-right`}
                title="Allocation-weighted gross supply APY of the adapter's markets (child vault: net APY). Excludes rewards and vault fees, so it can differ from the vault APY above."
              >
                Supply APY
              </th>
              <th className={`${th} text-right`}>Force dealloc. penalty</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className={td}>
                <span className="font-medium">Idle</span>
                <p className="text-xs text-muted-foreground">Unallocated vault cash</p>
              </td>
              <td className={`${td} text-muted-foreground`}>—</td>
              <td className={`${td} text-right tabular-nums`}>
                {formatToken(idleRaw, chainDecimals, displayDecimals, assetSymbol)}
                <p className="text-xs text-muted-foreground">{pctOfTotal(idleUsd, totalUsd)}</p>
              </td>
              <td className={`${td} text-right text-muted-foreground`}>No cap</td>
              <td className={`${td} text-right tabular-nums`} title={formatUSD(idleUsd, 2)}>
                {/* Idle cash is fully withdrawable, so liquidity = idle. */}
                {formatToken(idleRaw, chainDecimals, displayDecimals, assetSymbol)}
              </td>
              <td className={`${td} text-right text-muted-foreground`}>0%</td>
              <td className={`${td} text-right text-muted-foreground`}>—</td>
            </tr>
            {adapters.map((adapter) => {
              const key = adapter.address.toLowerCase();
              const product = vaultAdapterProduct(adapter);
              const isLiquidity = key === liquidityAdapterAddress;
              const riskAdapter = risk?.adapters?.find(
                (a) => a.adapterAddress.toLowerCase() === key
              );
              const usd = adapter.assetsUsd ?? 0;
              const allocationRaw = adapterAllocationRaw(
                riskAdapter?.allocationAssets,
                adapter.assets
              );
              const summary = summarizeAdapter({
                allocationUsd: riskAdapter?.allocationUsd ?? usd,
                markets: (riskAdapter?.markets ?? []).map((m) => ({
                  allocationUsd: m.allocationUsd,
                  liquidityUsd: m.market.state?.liquidityAssetsUsd,
                  supplyApy: m.market.state?.supplyApy,
                })),
                underlying: riskAdapter?.underlying ?? null,
              });
              const cap = data.caps.find(
                (c) => isAdapterCap(c) && c.adapterAddress?.toLowerCase() === key
              );
              const absoluteCap = riskAdapter?.absoluteCap ?? cap?.absoluteCap ?? null;
              const relativeCap = riskAdapter?.relativeCap ?? cap?.relativeCap ?? null;
              const underlying = isMorphoVaultV2Adapter(adapter)
                ? adapterLabel(adapter, vaultAddress)
                : summary.marketsCount > 0
                  ? `${summary.marketsCount} market${summary.marketsCount === 1 ? '' : 's'}${
                      summary.activeMarketsCount !== summary.marketsCount
                        ? ` (${summary.activeMarketsCount} allocated)`
                        : ''
                    }`
                  : '—';

              return (
                <tr
                  key={adapter.address}
                  className={cn(
                    product === 'blue' && 'bg-blue-50/80 dark:bg-blue-950/40',
                    product === 'midnight' && 'bg-neutral-100 dark:bg-neutral-900'
                  )}
                >
                  <td className={td}>
                    <div className="flex flex-col gap-1">
                      <span className="flex items-center gap-2 font-medium">
                        <span
                          className={cn(
                            'inline-block h-3 w-3 shrink-0 rounded-sm',
                            product === 'blue' && 'bg-blue-600',
                            product === 'midnight' && 'bg-black',
                            product == null && 'bg-muted-foreground/40'
                          )}
                          aria-hidden
                        />
                        {adapterLabel(adapter, vaultAddress)}
                      </span>
                      <AddressBadge address={adapter.address} truncate />
                      {isLiquidity && (
                        <Badge
                          variant="outline"
                          className="w-fit gap-1 border-emerald-500/40 text-[10px] font-normal text-emerald-700 dark:text-emerald-400"
                        >
                          <Zap className="h-2.5 w-2.5" />
                          Liquidity adapter
                        </Badge>
                      )}
                    </div>
                  </td>
                  <td className={td}>{underlying}</td>
                  <td className={`${td} text-right tabular-nums`}>
                    {allocationRaw != null
                      ? formatTokenRaw(allocationRaw, chainDecimals, displayDecimals, assetSymbol)
                      : '—'}
                    <p className="text-xs text-muted-foreground">
                      {pctOfTotal(usd, totalUsd)} · {formatUSD(usd, 2)}
                    </p>
                  </td>
                  <td className={`${td} text-right tabular-nums`}>
                    {absoluteCap != null
                      ? formatCapCompactAmount(absoluteCap, assetSymbol, assetDecimals)
                      : '—'}
                    <p className="text-xs text-muted-foreground">
                      {relativeCap != null ? formatCapRelative(relativeCap) : '—'}
                    </p>
                  </td>
                  <td className={`${td} text-right tabular-nums`}>
                    <span title={summary.liquidityUsd != null ? formatUSD(summary.liquidityUsd, 2) : undefined}>
                      {formatLiquidityTokens(summary.liquidityUsd, usd, allocationRaw, assetSymbol, assetDecimals)}
                    </span>
                  </td>
                  <td className={`${td} text-right tabular-nums`}>
                    {summary.rate != null ? formatPercentage(summary.rate * 100) : '—'}
                  </td>
                  <td className={`${td} text-right tabular-nums`}>
                    {formatForceDeallocatePenaltyWad(adapter.forceDeallocatePenalty)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {adapters.length === 0 ? (
        <div className="px-4 py-3">
          <CuratorEmptyText>No strategy adapters enabled.</CuratorEmptyText>
        </div>
      ) : null}
    </CuratorPanel>
  );
}

function adapterLabel(adapter: AdapterInfo, wrapperAddress: string): string {
  if (adapter.underlying?.name || adapter.underlying?.symbol) {
    return underlyingVaultLabel(adapter.underlying);
  }
  if (isMorphoVaultV2Adapter(adapter)) {
    const underlyingAddr = resolveUnderlyingVaultAddress(
      wrapperAddress,
      adapter.underlying?.address
    );
    const cfg = underlyingAddr ? getVaultByAddress(underlyingAddr) : undefined;
    if (cfg) return getConfiguredVaultDisplayName(cfg);
    return UNDERLYING_VAULT_FALLBACK;
  }
  return (
    adapter.metaMorpho?.name ??
    adapter.metaMorpho?.symbol ??
    (adapter.type === 'MetaMorpho' || adapter.type === 'MetaMorphoAdapter'
      ? 'MetaMorpho Adapter'
      : 'Variable Rate Market Adapter')
  );
}

function pctOfTotal(amountUsd: number, totalUsd: number): string {
  if (totalUsd <= 0) return '0%';
  return `${((amountUsd / totalUsd) * 100).toFixed(1)}%`;
}

function formatToken(
  raw: string | null,
  decimals: number,
  displayDecimals: number,
  symbol?: string | null
): string {
  if (!raw) return symbol ? `0 ${symbol}` : '0';
  try {
    const f = formatRawTokenAmount(BigInt(raw), decimals, displayDecimals);
    return symbol ? `${f} ${symbol}` : f;
  } catch {
    return '—';
  }
}

function formatTokenRaw(
  raw: bigint,
  decimals: number,
  displayDecimals: number,
  symbol?: string | null
): string {
  const f = formatRawTokenAmount(raw, decimals, displayDecimals);
  return symbol ? `${f} ${symbol}` : f;
}

/**
 * Withdrawable liquidity as a compact token amount (Morpho shows `24.85k USDC`).
 * Converted with the adapter's own token/USD ratio; USD stays in the tooltip.
 */
function formatLiquidityTokens(
  liquidityUsd: number | null,
  allocationUsd: number,
  allocationRaw: bigint | null,
  symbol: string | null | undefined,
  decimals: number | null | undefined
): string {
  if (liquidityUsd == null) return '—';
  if (liquidityUsd <= 0) return symbol ? `0 ${symbol}` : '0';
  if (allocationRaw == null || allocationUsd <= 0) return formatUSD(liquidityUsd, 2);
  const raw = estimateRawFromUsd(liquidityUsd, allocationUsd, allocationRaw);
  return raw != null ? formatCapCompactAmount(raw.toString(), symbol, decimals) : formatUSD(liquidityUsd, 2);
}
