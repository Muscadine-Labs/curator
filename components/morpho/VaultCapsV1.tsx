'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useVaultCaps } from '@/lib/hooks/useVaultCaps';
import { formatUSD, formatTokenAmount } from '@/lib/format/number';
import { ExternalLink, Pencil, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useVaultWrite } from '@/lib/hooks/useVaultWrite';
import { TransactionButton } from '@/components/TransactionButton';
import { v1WriteConfigs } from '@/lib/onchain/vault-writes';
import { parseUnits } from 'viem';
import type { Address } from 'viem';
import type { MarketCap, VaultCapsData } from '@/lib/hooks/useVaultCaps';

interface VaultCapsV1Props {
  vaultAddress: Address | string;
  preloadedData?: VaultCapsData | null;
}

function formatMarketName(loanAsset: string, collateralAsset: string): string {
  return `${loanAsset}/${collateralAsset}`;
}

export function VaultCapsV1({ vaultAddress, preloadedData }: VaultCapsV1Props) {
  const { data: fetchedData, isLoading, error } = useVaultCaps(vaultAddress);
  const data = preloadedData ?? fetchedData;

  if (!preloadedData && isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Market Caps</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Market Caps</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-red-600 dark:text-red-400">
            Failed to load market caps: {error instanceof Error ? error.message : 'Unknown error'}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (data.markets.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Market Caps</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="py-8 text-center text-slate-500 dark:text-slate-400">
            No market caps found for this vault.
          </p>
        </CardContent>
      </Card>
    );
  }

  const sortedMarkets = [...data.markets].sort((a, b) => {
    const aAmount = a.supplyAssetsUsd ?? a.supplyAssets ?? 0;
    const bAmount = b.supplyAssetsUsd ?? b.supplyAssets ?? 0;
    return bAmount - aAmount;
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Market Caps</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {sortedMarkets.map((market) => (
          <MarketCapRow key={market.marketKey} vaultAddress={vaultAddress} market={market} />
        ))}
      </CardContent>
    </Card>
  );
}

function MarketCapRow({ vaultAddress, market }: { vaultAddress: Address | string; market: MarketCap }) {
  const [open, setOpen] = useState(false);
  const marketName = formatMarketName(market.loanAsset.symbol, market.collateralAsset.symbol);
  const hasPending =
    (market.supplyQueueIndex !== null && market.supplyQueueIndex !== undefined) ||
    (market.withdrawQueueIndex !== null && market.withdrawQueueIndex !== undefined);

  const decimals = market.loanAsset.decimals;
  const supplyCapTokens = market.supplyCap !== null ? market.supplyCap / Math.pow(10, decimals) : null;
  const supplyAssetsTokens = market.supplyAssets !== null ? market.supplyAssets / Math.pow(10, decimals) : null;

  const supplyCapUsd =
    supplyCapTokens !== null &&
    supplyAssetsTokens !== null &&
    market.supplyAssetsUsd !== null &&
    supplyAssetsTokens > 0
      ? (supplyCapTokens / supplyAssetsTokens) * market.supplyAssetsUsd
      : null;

  const utilization =
    supplyCapTokens !== null && supplyAssetsTokens !== null
      ? (supplyAssetsTokens / supplyCapTokens) * 100
      : null;

  const maxInTokens =
    supplyCapTokens !== null && supplyAssetsTokens !== null ? supplyCapTokens - supplyAssetsTokens : null;

  return (
    <div className="border-b border-slate-200 pb-6 last:border-0 last:pb-0 dark:border-slate-700">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Badge variant="outline" className="text-sm font-medium">
              {marketName}
            </Badge>
            <a
              href={`https://app.morpho.org/markets/${market.marketKey}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
            >
              View Market <ExternalLink className="h-3 w-3" />
            </a>
            {hasPending && (
              <Badge variant="secondary" className="text-xs">
                Pending
              </Badge>
            )}
          </div>
          <Button
            size="sm"
            variant={open ? 'secondary' : 'outline'}
            onClick={() => setOpen((v) => !v)}
            aria-label="Edit cap"
          >
            {open ? <X className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
            <span className="ml-1">{open ? 'Cancel' : 'Edit Cap'}</span>
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Supply Cap</div>
            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {supplyCapTokens !== null
                ? formatTokenAmount(market.supplyCap, decimals, 2) + ' ' + market.loanAsset.symbol
                : 'Unlimited'}
            </div>
            {supplyCapUsd !== null && (
              <div className="text-xs text-slate-500 dark:text-slate-400">{formatUSD(supplyCapUsd, 2)}</div>
            )}
          </div>

          <div className="space-y-1">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Current Supply</div>
            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {supplyAssetsTokens !== null
                ? formatTokenAmount(market.supplyAssets, decimals, 2) + ' ' + market.loanAsset.symbol
                : 'N/A'}
            </div>
            {supplyAssetsTokens !== null && market.supplyAssetsUsd !== null && (
              <div className="text-xs text-slate-500 dark:text-slate-400">
                {formatUSD(market.supplyAssetsUsd, 2)}
              </div>
            )}
            {utilization !== null && (
              <div className="text-xs text-slate-500 dark:text-slate-400">
                {utilization.toFixed(2)}% utilized
              </div>
            )}
          </div>

          <div className="space-y-1">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Max In</div>
            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {maxInTokens !== null && maxInTokens > 0
                ? new Intl.NumberFormat('en-US', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  }).format(maxInTokens) +
                  ' ' +
                  market.loanAsset.symbol
                : market.supplyCap === null
                  ? 'Unlimited'
                  : '0.00 ' + market.loanAsset.symbol}
            </div>
            {maxInTokens !== null &&
              maxInTokens > 0 &&
              market.supplyAssetsUsd !== null &&
              supplyAssetsTokens !== null &&
              supplyAssetsTokens > 0 && (
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {formatUSD((maxInTokens / supplyAssetsTokens) * market.supplyAssetsUsd, 2)}
                </div>
              )}
          </div>

          <div className="space-y-1">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Max Out</div>
            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {supplyAssetsTokens !== null
                ? formatTokenAmount(market.supplyAssets, decimals, 2) + ' ' + market.loanAsset.symbol
                : 'N/A'}
            </div>
            {supplyAssetsTokens !== null && market.supplyAssetsUsd !== null && (
              <div className="text-xs text-slate-500 dark:text-slate-400">
                {formatUSD(market.supplyAssetsUsd, 2)}
              </div>
            )}
          </div>
        </div>

        {open && <CapEditForm vaultAddress={vaultAddress} market={market} />}
      </div>
    </div>
  );
}

function CapEditForm({ vaultAddress, market }: { vaultAddress: Address | string; market: MarketCap }) {
  const [oracle, setOracle] = useState('');
  const [irm, setIrm] = useState('');
  const [lltv, setLltv] = useState('');
  const [cap, setCap] = useState('');
  const submitCapWrite = useVaultWrite();
  const acceptCapWrite = useVaultWrite();

  const canSubmit = !!oracle && !!irm && !!lltv && !!cap;
  const canAccept = !!oracle && !!irm && !!lltv;

  const buildMarketParams = () => ({
    loanToken: market.loanAsset.address as Address,
    collateralToken: market.collateralAsset.address as Address,
    oracle: oracle as Address,
    irm: irm as Address,
    lltv: BigInt(lltv),
  });

  return (
    <div className="mt-2 space-y-3 rounded-md border border-dashed border-slate-300 bg-slate-50/60 p-3 dark:border-slate-700 dark:bg-slate-800/40">
      <p className="text-[11px] text-slate-500">
        Morpho V1 requires full MarketParams to submit/accept caps. Enter Oracle, IRM and LLTV
        (see Morpho docs for the exact market config).
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <label className="text-[11px] text-slate-500">Oracle</label>
          <Input placeholder="0x…" value={oracle} onChange={(e) => setOracle(e.target.value)} />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] text-slate-500">IRM</label>
          <Input placeholder="0x…" value={irm} onChange={(e) => setIrm(e.target.value)} />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] text-slate-500">LLTV (WAD)</label>
          <Input
            placeholder="e.g. 860000000000000000"
            value={lltv}
            onChange={(e) => setLltv(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] text-slate-500">
            New Supply Cap (in {market.loanAsset.symbol})
          </label>
          <Input
            placeholder="e.g. 1000000"
            value={cap}
            onChange={(e) => setCap(e.target.value)}
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <TransactionButton
          label="Submit Cap"
          onClick={() => {
            if (!canSubmit) return;
            const capBigInt = parseUnits(cap, market.loanAsset.decimals);
            submitCapWrite.write(
              v1WriteConfigs.submitCap(vaultAddress as Address, buildMarketParams(), capBigInt),
            );
          }}
          disabled={!canSubmit}
          isLoading={submitCapWrite.isLoading}
          isSuccess={submitCapWrite.isSuccess}
          error={submitCapWrite.error}
          txHash={submitCapWrite.txHash}
        />
        <TransactionButton
          label="Accept Cap"
          onClick={() => {
            if (!canAccept) return;
            acceptCapWrite.write(v1WriteConfigs.acceptCap(vaultAddress as Address, buildMarketParams()));
          }}
          disabled={!canAccept}
          isLoading={acceptCapWrite.isLoading}
          isSuccess={acceptCapWrite.isSuccess}
          error={acceptCapWrite.error}
          txHash={acceptCapWrite.txHash}
        />
      </div>
    </div>
  );
}
