'use client';

import { useCallback, useMemo, useState } from 'react';
import type { Address } from 'viem';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { TransactionButton } from '@/components/TransactionButton';
import { AllocationPill } from '@/components/morpho/AllocationListView';
import { useVaultWrite } from '@/lib/hooks/useVaultWrite';
import { v2WriteConfigs } from '@/lib/onchain/vault-writes';
import { formatAllocationTableAmount } from '@/lib/format/allocation-display';
import { resolveAssetDecimals } from '@/lib/format/asset-decimals';
import {
  buildLiquidityAdapterOptions,
  resolveLiquidityDisplay,
  type LiquidityAdapterOption,
} from '@/lib/morpho/vault-v2-liquidity';
import type { VaultV2GovernanceResponse } from '@/app/api/vaults/[id]/governance/route';
import type { V2VaultRiskResponse } from '@/app/api/vaults/[id]/risk/route';

interface VaultV2LiquidityAdapterProps {
  vaultAddress: string;
  governance: VaultV2GovernanceResponse | null | undefined;
  risk: V2VaultRiskResponse;
}

function LiquidityMarketLabel({
  option,
}: {
  option: Pick<LiquidityAdapterOption, 'label' | 'lltv' | 'morphoHref'>;
}) {
  const inner = (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="font-medium text-slate-900 dark:text-slate-100">{option.label}</span>
      {option.lltv ? <AllocationPill>{option.lltv}</AllocationPill> : null}
    </span>
  );

  if (!option.morphoHref) return inner;

  return (
    <a
      href={option.morphoHref}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex flex-wrap items-center gap-2 hover:opacity-80"
      onClick={(e) => e.stopPropagation()}
    >
      {inner}
    </a>
  );
}

export function VaultV2LiquidityAdapter({
  vaultAddress,
  governance,
  risk,
}: VaultV2LiquidityAdapterProps) {
  const [changing, setChanging] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const write = useVaultWrite();

  const assetSymbol = risk.vaultAsset?.symbol ?? undefined;
  const assetDecimals = resolveAssetDecimals(
    risk.vaultAsset?.symbol,
    risk.vaultAsset?.decimals
  );

  const display = resolveLiquidityDisplay(governance);
  const options = useMemo(
    () => (governance ? buildLiquidityAdapterOptions(risk, governance) : []),
    [risk, governance]
  );

  const selected = options.find((o) => o.key === selectedKey) ?? null;
  const currentOption = options.find((o) => o.isCurrent) ?? null;

  const liquidityRaw = governance?.liquidity ?? null;
  const liquidityLabel =
    liquidityRaw != null
      ? formatAllocationTableAmount(BigInt(liquidityRaw), assetSymbol, assetDecimals)
      : '—';

  const closePanel = useCallback(() => {
    setChanging(false);
    setSelectedKey(null);
    write.reset();
  }, [write]);

  const openPanel = useCallback(() => {
    write.reset();
    setSelectedKey(currentOption?.key ?? options[0]?.key ?? null);
    setChanging(true);
  }, [write, currentOption?.key, options]);

  const submitChange = useCallback(() => {
    if (!selected || selected.isCurrent) return;
    write.write(
      v2WriteConfigs.setLiquidityAdapterAndData(
        vaultAddress as Address,
        selected.adapterAddress as Address,
        selected.liquidityData
      )
    );
  }, [selected, vaultAddress, write]);

  if (!governance?.liquidityAdapter?.address && options.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="text-base">Liquidity Adapter</CardTitle>
          {!changing ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={openPanel}
              disabled={options.length === 0}
            >
              Change
            </Button>
          ) : (
            <Button type="button" variant="ghost" size="sm" onClick={closePanel}>
              Cancel
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="divide-y divide-slate-200 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
          <div className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
            <span className="text-slate-500 dark:text-slate-400">Active Adapter</span>
            <div className="text-right">
              {display.morphoHref ? (
                <a
                  href={display.morphoHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex flex-wrap items-center justify-end gap-2"
                >
                  <span className="font-medium text-blue-600 hover:underline dark:text-blue-400">
                    {display.label}
                  </span>
                  {display.lltv ? <AllocationPill>{display.lltv}</AllocationPill> : null}
                </a>
              ) : (
                <span className="inline-flex flex-wrap items-center justify-end gap-2">
                  <span className="font-medium text-slate-900 dark:text-slate-100">
                    {display.label}
                  </span>
                  {display.lltv ? <AllocationPill>{display.lltv}</AllocationPill> : null}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
            <span className="text-slate-500 dark:text-slate-400">Current Allocation</span>
            <span className="font-medium tabular-nums text-slate-900 dark:text-slate-100">
              {liquidityLabel}
            </span>
          </div>
        </div>

        {changing ? (
          <div className="space-y-3 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Select the market that provides withdrawable liquidity for this vault.
            </p>
            <div className="max-h-64 space-y-1 overflow-y-auto">
              {options.map((option) => {
                const active = selectedKey === option.key;
                return (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => setSelectedKey(option.key)}
                    className={`flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2.5 text-left text-sm transition-colors ${
                      active
                        ? 'border-blue-500 bg-blue-50/80 dark:border-blue-400 dark:bg-blue-950/40'
                        : 'border-transparent hover:bg-slate-50 dark:hover:bg-slate-900/60'
                    }`}
                  >
                    <LiquidityMarketLabel option={option} />
                    {option.isCurrent ? (
                      <Badge variant="outline" className="shrink-0 text-xs">
                        Current
                      </Badge>
                    ) : null}
                  </button>
                );
              })}
            </div>

            {write.error ? (
              <p className="text-xs text-red-600 dark:text-red-400 break-all">
                {write.error.message?.slice(0, 300)}
              </p>
            ) : null}

            <TransactionButton
              label="Update liquidity adapter"
              onClick={submitChange}
              disabled={!selected || selected.isCurrent}
              isLoading={write.isLoading}
              isSuccess={write.isSuccess}
              error={write.error}
              txHash={write.txHash}
            />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
