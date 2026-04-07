'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { useVaultV2Governance } from '@/lib/hooks/useVaultV2Governance';
import { useVaultWrite } from '@/lib/hooks/useVaultWrite';
import { TransactionButton } from '@/components/TransactionButton';
import { v2WriteConfigs } from '@/lib/onchain/vault-writes';
import { formatNumber } from '@/lib/format/number';
import type { VaultV2GovernanceResponse } from '@/app/api/vaults/v2/[id]/governance/route';
import type { Address, Hex } from 'viem';
import { parseUnits } from 'viem';

interface VaultV2CapsProps {
  vaultAddress: string;
  preloadedData?: VaultV2GovernanceResponse | null;
}

function formatRelativeCap(relativeCap: string): string {
  try {
    const scaled = BigInt(relativeCap);
    // Relative cap is scaled by 1e18; convert to %
    const percent = Number(scaled) / 1e16;
    return `${percent.toFixed(2)}%`;
  } catch {
    return relativeCap;
  }
}

function formatBigIntValue(value: string): string {
  try {
    return formatNumber(BigInt(value));
  } catch {
    return value;
  }
}

export function VaultV2Caps({ vaultAddress, preloadedData }: VaultV2CapsProps) {
  const { data: fetchedData, isLoading, error } = useVaultV2Governance(vaultAddress);
  const data = preloadedData ?? fetchedData;

  const [showManage, setShowManage] = useState(false);
  const [capAction, setCapAction] = useState<'increaseAbsolute' | 'decreaseAbsolute' | 'increaseRelative' | 'decreaseRelative'>('increaseAbsolute');
  const [capIdData, setCapIdData] = useState('');
  const [capValue, setCapValue] = useState('');
  const capWrite = useVaultWrite();

  if (!preloadedData && isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Adapter Caps</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Adapter Caps</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-red-600 dark:text-red-400">
            Failed to load caps: {error instanceof Error ? error.message : 'Unknown error'}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (data.caps.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Adapter Caps</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-500 dark:text-slate-400">No caps configured.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Adapter Caps</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 gap-2">
          {data.caps.map((cap, idx) => {
            const targetLabel =
              cap.adapterAddress ??
              cap.marketKey ??
              cap.collateralAddress ??
              'Global Cap';

            return (
              <div
                key={`${targetLabel}-${idx}`}
                className="grid grid-cols-1 gap-3 rounded-md border border-slate-200 p-4 text-sm dark:border-slate-800 sm:grid-cols-5 sm:items-center"
              >
                <div>
                  <p className="text-xs uppercase text-slate-500 dark:text-slate-400">Type</p>
                  <div className="mt-1 flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                      {cap.type}
                    </Badge>
                    <span className="text-xs text-slate-500 dark:text-slate-400 break-all">{targetLabel}</span>
                  </div>
                </div>
                <div>
                  <p className="text-xs uppercase text-slate-500 dark:text-slate-400">Absolute Cap</p>
                  <p className="mt-1 font-semibold text-slate-900 dark:text-slate-100">
                    {formatBigIntValue(cap.absoluteCap)}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase text-slate-500 dark:text-slate-400">Relative Cap</p>
                  <p className="mt-1 font-semibold text-slate-900 dark:text-slate-100">
                    {formatRelativeCap(cap.relativeCap)}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase text-slate-500 dark:text-slate-400">Allocation</p>
                  <p className="mt-1 font-semibold text-slate-900 dark:text-slate-100">
                    {formatBigIntValue(cap.allocation)}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase text-slate-500 dark:text-slate-400">Adapter</p>
                  <p className="mt-1 break-all text-slate-700 dark:text-slate-200">
                    {cap.adapterAddress ?? 'N/A'}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Manage Section */}
        <div className="border-t pt-4">
          <button
            onClick={() => setShowManage(!showManage)}
            className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100"
          >
            {showManage ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            Manage Caps
          </button>

          {showManage && (
            <div className="mt-4 space-y-4">
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-4 space-y-4">
                <h4 className="text-sm font-semibold">Modify Cap</h4>
                <div className="flex flex-wrap gap-2">
                  {(['increaseAbsolute', 'decreaseAbsolute', 'increaseRelative', 'decreaseRelative'] as const).map((a) => (
                    <button
                      key={a}
                      onClick={() => setCapAction(a)}
                      className={`px-3 py-1 rounded-md text-xs font-medium ${capAction === a ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'}`}
                    >
                      {a === 'increaseAbsolute' ? 'Increase Absolute' : a === 'decreaseAbsolute' ? 'Decrease Absolute' : a === 'increaseRelative' ? 'Increase Relative' : 'Decrease Relative'}
                    </button>
                  ))}
                </div>
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">ID Data (bytes)</label>
                  <Input
                    type="text"
                    placeholder="0x..."
                    value={capIdData}
                    onChange={(e) => setCapIdData(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">
                    {capAction.includes('Relative') || capAction.includes('relative') ? 'New Relative Cap (%)' : 'New Absolute Cap (raw uint256)'}
                  </label>
                  <Input
                    type="text"
                    placeholder={capAction.includes('relative') || capAction.includes('Relative') ? 'e.g. 50 for 50%' : 'e.g. 1000000000000000000'}
                    value={capValue}
                    onChange={(e) => setCapValue(e.target.value)}
                  />
                </div>
                <TransactionButton
                  label={capAction === 'increaseAbsolute' ? 'Increase Absolute Cap' : capAction === 'decreaseAbsolute' ? 'Decrease Absolute Cap' : capAction === 'increaseRelative' ? 'Increase Relative Cap' : 'Decrease Relative Cap'}
                  onClick={() => {
                    if (!capIdData || !capValue) return;
                    let value: bigint;
                    if (capAction.includes('elative')) {
                      // Convert percentage to WAD (1e18 = 100%)
                      value = BigInt(Math.floor(parseFloat(capValue) * 1e16));
                    } else {
                      value = BigInt(capValue);
                    }
                    const configs = {
                      increaseAbsolute: v2WriteConfigs.increaseAbsoluteCap,
                      decreaseAbsolute: v2WriteConfigs.decreaseAbsoluteCap,
                      increaseRelative: v2WriteConfigs.increaseRelativeCap,
                      decreaseRelative: v2WriteConfigs.decreaseRelativeCap,
                    };
                    const config = configs[capAction](vaultAddress as Address, capIdData as Hex, value);
                    capWrite.write(config);
                  }}
                  disabled={!capIdData || !capValue}
                  isLoading={capWrite.isLoading}
                  isSuccess={capWrite.isSuccess}
                  error={capWrite.error}
                  txHash={capWrite.txHash}
                />
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

