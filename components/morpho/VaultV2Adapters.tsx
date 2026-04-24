'use client';

import { useMemo, useState } from 'react';
import { Zap, Plus, Pencil, X, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { AddressBadge } from '@/components/AddressBadge';
import { useVaultV2Governance } from '@/lib/hooks/useVaultV2Governance';
import { useVaultWrite } from '@/lib/hooks/useVaultWrite';
import { TransactionButton } from '@/components/TransactionButton';
import { v2WriteConfigs } from '@/lib/onchain/vault-writes';
import { formatUSD, formatNumber } from '@/lib/format/number';
import { isAddress, type Address, type Hex } from 'viem';
import type { AdapterInfo, VaultV2GovernanceResponse } from '@/app/api/vaults/v2/[id]/governance/route';

interface VaultV2AdaptersProps {
  vaultAddress: string;
  preloadedData?: VaultV2GovernanceResponse | null;
}

export function VaultV2Adapters({ vaultAddress, preloadedData }: VaultV2AdaptersProps) {
  const { data: fetchedData, isLoading, error } = useVaultV2Governance(vaultAddress);
  const data = preloadedData ?? fetchedData;

  const liquidityAdapterAddress = data?.liquidityAdapter?.address?.toLowerCase();

  const adapters = useMemo<AdapterInfo[]>(() => {
    if (!data?.adapters) return [];
    return [...data.adapters].sort((a, b) => (b.assetsUsd ?? 0) - (a.assetsUsd ?? 0));
  }, [data?.adapters]);

  const [addOpen, setAddOpen] = useState(false);
  const [liquidityOpen, setLiquidityOpen] = useState(false);

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

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Adapters</CardTitle>
          <div className="flex items-center gap-2">
            <Button size="sm" variant={liquidityOpen ? 'secondary' : 'outline'} onClick={() => setLiquidityOpen((v) => !v)}>
              {liquidityOpen ? <X className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
              <span className="ml-1">Liquidity adapter</span>
            </Button>
            <Button size="sm" variant={addOpen ? 'secondary' : 'default'} onClick={() => setAddOpen((v) => !v)}>
              {addOpen ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
              <span className="ml-1">Add adapter</span>
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {addOpen && <AddAdapterForm vaultAddress={vaultAddress} onDone={() => setAddOpen(false)} />}
        {liquidityOpen && <LiquidityAdapterForm vaultAddress={vaultAddress} onDone={() => setLiquidityOpen(false)} />}

        {adapters.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">No adapters configured for this vault.</p>
        ) : (
          adapters.map((adapter) => {
            const label =
              adapter.metaMorpho?.name ??
              adapter.metaMorpho?.symbol ??
              (adapter.type === 'MetaMorpho' ? 'MetaMorpho Adapter' : 'Morpho Market Adapter');

            const isLiquidity = adapter.address.toLowerCase() === liquidityAdapterAddress;

            return (
              <AdapterRow
                key={adapter.address}
                vaultAddress={vaultAddress}
                adapter={adapter}
                label={label}
                isLiquidity={isLiquidity}
              />
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

function AdapterRow({
  vaultAddress,
  adapter,
  label,
  isLiquidity,
}: {
  vaultAddress: string;
  adapter: AdapterInfo;
  label: string;
  isLiquidity: boolean;
}) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const write = useVaultWrite();
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-base font-semibold text-slate-900 dark:text-slate-100">{label}</p>
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
        <div className="space-y-1 text-right">
          <p className="text-sm text-slate-500 dark:text-slate-400">Allocated</p>
          <p className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            {adapter.assetsUsd !== null && adapter.assetsUsd !== undefined
              ? formatUSD(adapter.assetsUsd, 2)
              : 'N/A'}
          </p>
          {adapter.assets !== null && adapter.assets !== undefined && (
            <p className="text-xs text-slate-500 dark:text-slate-400">Raw: {formatNumber(adapter.assets)} units</p>
          )}
          <div className="flex justify-end pt-2">
            {confirmRemove ? (
              <div className="flex items-center gap-1">
                <TransactionButton
                  label="Remove"
                  variant="destructive"
                  onClick={() =>
                    write.write(v2WriteConfigs.removeAdapter(vaultAddress as Address, adapter.address as Address))
                  }
                  isLoading={write.isLoading}
                  isSuccess={write.isSuccess}
                  error={write.error}
                  txHash={write.txHash}
                />
                <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(false)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                aria-label="Remove adapter"
                onClick={() => setConfirmRemove(true)}
              >
                <Trash2 className="mr-1 h-3.5 w-3.5" /> Remove
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function AddAdapterForm({ vaultAddress, onDone }: { vaultAddress: string; onDone: () => void }) {
  const [addr, setAddr] = useState('');
  const write = useVaultWrite();
  const valid = isAddress(addr);
  return (
    <div className="rounded-md border border-dashed border-slate-300 bg-slate-50/60 p-3 dark:border-slate-700 dark:bg-slate-800/40">
      <p className="mb-2 text-[11px] text-slate-500">Timelocked operation. Enter the new adapter address.</p>
      <Input type="text" placeholder="0x…" value={addr} onChange={(e) => setAddr(e.target.value)} />
      <div className="mt-2 flex items-center gap-2">
        <TransactionButton
          label="Add Adapter"
          onClick={() => {
            if (!valid) return;
            write.write(v2WriteConfigs.addAdapter(vaultAddress as Address, addr as Address));
          }}
          disabled={!valid}
          isLoading={write.isLoading}
          isSuccess={write.isSuccess}
          error={write.error}
          txHash={write.txHash}
        />
        {write.isSuccess && (
          <Button size="sm" variant="outline" onClick={onDone}>
            Done
          </Button>
        )}
      </div>
    </div>
  );
}

function LiquidityAdapterForm({ vaultAddress, onDone }: { vaultAddress: string; onDone: () => void }) {
  const [addr, setAddr] = useState('');
  const [data, setData] = useState<string>('0x');
  const write = useVaultWrite();
  const valid = isAddress(addr);
  return (
    <div className="space-y-2 rounded-md border border-dashed border-slate-300 bg-slate-50/60 p-3 dark:border-slate-700 dark:bg-slate-800/40">
      <div className="space-y-1">
        <label className="text-[11px] text-slate-500">Adapter address</label>
        <Input type="text" placeholder="0x…" value={addr} onChange={(e) => setAddr(e.target.value)} />
      </div>
      <div className="space-y-1">
        <label className="text-[11px] text-slate-500">Data (bytes, optional)</label>
        <Input type="text" placeholder="0x" value={data} onChange={(e) => setData(e.target.value)} />
      </div>
      <div className="flex items-center gap-2">
        <TransactionButton
          label="Set Liquidity Adapter"
          onClick={() => {
            if (!valid) return;
            write.write(
              v2WriteConfigs.setLiquidityAdapterAndData(
                vaultAddress as Address,
                addr as Address,
                (data || '0x') as Hex,
              ),
            );
          }}
          disabled={!valid}
          isLoading={write.isLoading}
          isSuccess={write.isSuccess}
          error={write.error}
          txHash={write.txHash}
        />
        {write.isSuccess && (
          <Button size="sm" variant="outline" onClick={onDone}>
            Done
          </Button>
        )}
      </div>
    </div>
  );
}
