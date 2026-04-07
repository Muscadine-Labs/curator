'use client';

import { useMemo, useState } from 'react';
import { Zap, ChevronDown, ChevronUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { AddressBadge } from '@/components/AddressBadge';
import { useVaultV2Governance } from '@/lib/hooks/useVaultV2Governance';
import { useVaultWrite } from '@/lib/hooks/useVaultWrite';
import { TransactionButton } from '@/components/TransactionButton';
import { v2WriteConfigs } from '@/lib/onchain/vault-writes';
import { formatUSD, formatNumber } from '@/lib/format/number';
import type { VaultV2GovernanceResponse } from '@/app/api/vaults/v2/[id]/governance/route';
import type { Address, Hex } from 'viem';

interface VaultV2AdaptersProps {
  vaultAddress: string;
  preloadedData?: VaultV2GovernanceResponse | null;
}

export function VaultV2Adapters({ vaultAddress, preloadedData }: VaultV2AdaptersProps) {
  const { data: fetchedData, isLoading, error } = useVaultV2Governance(vaultAddress);
  const data = preloadedData ?? fetchedData;

  const liquidityAdapterAddress = data?.liquidityAdapter?.address?.toLowerCase();

  const adapters = useMemo(() => {
    if (!data?.adapters) return [];
    return [...data.adapters].sort((a, b) => (b.assetsUsd ?? 0) - (a.assetsUsd ?? 0));
  }, [data?.adapters]);

  const [showManage, setShowManage] = useState(false);
  const [newAdapterAddr, setNewAdapterAddr] = useState('');
  const [removeAdapterAddr, setRemoveAdapterAddr] = useState('');
  const [liquidityAdapter, setLiquidityAdapter] = useState('');
  const [liquidityData, setLiquidityData] = useState('0x');
  const addAdapterWrite = useVaultWrite();
  const removeAdapterWrite = useVaultWrite();
  const liquidityWrite = useVaultWrite();

  if (!preloadedData && isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Adapters</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
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
          <CardTitle>Adapters</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-red-600 dark:text-red-400">
            Failed to load adapters: {error instanceof Error ? error.message : 'Unknown error'}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (adapters.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Adapters</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-500 dark:text-slate-400">No adapters configured for this vault.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Adapters</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {adapters.map((adapter) => {
          const label =
            adapter.metaMorpho?.name ??
            adapter.metaMorpho?.symbol ??
            (adapter.type === 'MetaMorpho' ? 'MetaMorpho Adapter' : 'Morpho Market Adapter');

          const isLiquidity = adapter.address.toLowerCase() === liquidityAdapterAddress;

          return (
            <div
              key={adapter.address}
              className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950"
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-base font-semibold text-slate-900 dark:text-slate-100">
                      {label}
                    </p>
                    <Badge variant="outline" className="text-xs">
                      {adapter.type === 'MetaMorpho' ? 'Vault Adapter' : 'Market Adapter'}
                    </Badge>
                    {isLiquidity && (
                      <Badge className="flex items-center gap-1 bg-emerald-600 text-white">
                        <Zap className="h-3 w-3" />
                        Liquidity Adapter
                      </Badge>
                    )}
                  </div>
                  <AddressBadge address={adapter.address} truncate={false} />
                  {adapter.metaMorpho?.address && (
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Underlying vault: <AddressBadge address={adapter.metaMorpho.address} truncate={false} />
                    </p>
                  )}
                </div>
                <div className="text-right space-y-1">
                  <p className="text-sm text-slate-500 dark:text-slate-400">Allocated</p>
                  <p className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                    {adapter.assetsUsd !== null && adapter.assetsUsd !== undefined
                      ? formatUSD(adapter.assetsUsd, 2)
                      : 'N/A'}
                  </p>
                  {adapter.assets !== null && adapter.assets !== undefined && (
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Raw: {formatNumber(adapter.assets)} units
                    </p>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {/* Manage Section */}
        <div className="border-t pt-4">
          <button
            onClick={() => setShowManage(!showManage)}
            className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100"
          >
            {showManage ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            Manage Adapters
          </button>

          {showManage && (
            <div className="mt-4 space-y-4">
              {/* Add Adapter */}
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-4 space-y-3">
                <h4 className="text-sm font-semibold">Add Adapter</h4>
                <p className="text-xs text-muted-foreground">Timelocked operation</p>
                <Input type="text" placeholder="0x..." value={newAdapterAddr} onChange={(e) => setNewAdapterAddr(e.target.value)} />
                <TransactionButton
                  label="Add Adapter"
                  onClick={() => { if (!newAdapterAddr) return; addAdapterWrite.write(v2WriteConfigs.addAdapter(vaultAddress as Address, newAdapterAddr as Address)); }}
                  disabled={!newAdapterAddr}
                  isLoading={addAdapterWrite.isLoading}
                  isSuccess={addAdapterWrite.isSuccess}
                  error={addAdapterWrite.error}
                  txHash={addAdapterWrite.txHash}
                />
              </div>

              {/* Remove Adapter */}
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-4 space-y-3">
                <h4 className="text-sm font-semibold">Remove Adapter</h4>
                <select
                  value={removeAdapterAddr}
                  onChange={(e) => setRemoveAdapterAddr(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="">Select adapter...</option>
                  {adapters.map((a) => (
                    <option key={a.address} value={a.address}>
                      {a.metaMorpho?.name ?? a.metaMorpho?.symbol ?? a.address}
                    </option>
                  ))}
                </select>
                <TransactionButton
                  label="Remove Adapter"
                  variant="destructive"
                  onClick={() => { if (!removeAdapterAddr) return; removeAdapterWrite.write(v2WriteConfigs.removeAdapter(vaultAddress as Address, removeAdapterAddr as Address)); }}
                  disabled={!removeAdapterAddr}
                  isLoading={removeAdapterWrite.isLoading}
                  isSuccess={removeAdapterWrite.isSuccess}
                  error={removeAdapterWrite.error}
                  txHash={removeAdapterWrite.txHash}
                />
              </div>

              {/* Set Liquidity Adapter */}
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-4 space-y-3">
                <h4 className="text-sm font-semibold">Set Liquidity Adapter</h4>
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">Adapter Address</label>
                  <Input type="text" placeholder="0x..." value={liquidityAdapter} onChange={(e) => setLiquidityAdapter(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">Data (bytes, optional)</label>
                  <Input type="text" placeholder="0x" value={liquidityData} onChange={(e) => setLiquidityData(e.target.value)} />
                </div>
                <TransactionButton
                  label="Set Liquidity Adapter"
                  onClick={() => { if (!liquidityAdapter) return; liquidityWrite.write(v2WriteConfigs.setLiquidityAdapterAndData(vaultAddress as Address, liquidityAdapter as Address, liquidityData as Hex)); }}
                  disabled={!liquidityAdapter}
                  isLoading={liquidityWrite.isLoading}
                  isSuccess={liquidityWrite.isSuccess}
                  error={liquidityWrite.error}
                  txHash={liquidityWrite.txHash}
                />
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

