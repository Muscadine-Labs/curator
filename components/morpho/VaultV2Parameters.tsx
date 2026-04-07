'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { useQuery } from '@tanstack/react-query';
import { useVaultWrite } from '@/lib/hooks/useVaultWrite';
import { TransactionButton } from '@/components/TransactionButton';
import { v2WriteConfigs } from '@/lib/onchain/vault-writes';
import { vaultV2Abi } from '@/lib/onchain/abis';
import { multicallRead } from '@/lib/onchain/client';
import type { Address, Abi } from 'viem';

interface VaultV2ParametersProps {
  vaultAddress: string;
}

async function fetchV2Params(vaultAddress: Address) {
  const abi = vaultV2Abi as unknown as Abi;

  const [performanceFee, managementFee, timelock, maxRate, name, symbol] =
    await multicallRead<bigint | string>([
      { address: vaultAddress, abi, functionName: 'performanceFee' },
      { address: vaultAddress, abi, functionName: 'managementFee' },
      { address: vaultAddress, abi, functionName: 'timelock' },
      { address: vaultAddress, abi, functionName: 'maxRate' },
      { address: vaultAddress, abi, functionName: 'name' },
      { address: vaultAddress, abi, functionName: 'symbol' },
    ]);

  return {
    performanceFee: performanceFee != null ? Number(performanceFee) / 1e16 : null,
    managementFee: managementFee != null ? Number(managementFee) / 1e16 : null,
    timelock: timelock != null ? Number(timelock) : null,
    maxRate: maxRate != null ? maxRate.toString() : null,
    name: name != null ? String(name) : null,
    symbol: symbol != null ? String(symbol) : null,
  };
}

function formatDuration(seconds: number | null): string {
  if (seconds == null) return 'N/A';
  if (seconds === 0) return 'Instant';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  if (days > 0) return `${days}d ${hours}h`;
  return `${hours}h ${Math.floor((seconds % 3600) / 60)}m`;
}

export function VaultV2Parameters({ vaultAddress }: VaultV2ParametersProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['vault-v2-parameters', vaultAddress],
    queryFn: () => fetchV2Params(vaultAddress as Address),
    enabled: !!vaultAddress,
  });

  const [showManage, setShowManage] = useState(false);
  const [perfFee, setPerfFee] = useState('');
  const [mgmtFee, setMgmtFee] = useState('');
  const [maxRateInput, setMaxRateInput] = useState('');
  const [newName, setNewName] = useState('');
  const [newSymbol, setNewSymbol] = useState('');

  const perfFeeWrite = useVaultWrite();
  const mgmtFeeWrite = useVaultWrite();
  const maxRateWrite = useVaultWrite();
  const nameWrite = useVaultWrite();
  const symbolWrite = useVaultWrite();

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Parameters</CardTitle>
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
          <CardTitle>Parameters</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-red-600 dark:text-red-400">
            Failed to load parameters: {error instanceof Error ? error.message : 'Unknown error'}
          </p>
        </CardContent>
      </Card>
    );
  }

  const params = [
    { label: 'Performance Fee', value: data.performanceFee != null ? `${data.performanceFee.toFixed(2)}%` : 'N/A' },
    { label: 'Management Fee', value: data.managementFee != null ? `${data.managementFee.toFixed(2)}%` : 'N/A' },
    { label: 'Timelock', value: formatDuration(data.timelock) },
    { label: 'Max Rate', value: data.maxRate ?? 'N/A' },
    { label: 'Name', value: data.name ?? 'N/A' },
    { label: 'Symbol', value: data.symbol ?? 'N/A' },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Parameters</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          {params.map((p) => (
            <div key={p.label} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
              <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">{p.label}</div>
              <div className="mt-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                {p.value}
              </div>
            </div>
          ))}
        </div>

        {/* Manage Section */}
        <div className="border-t pt-4">
          <button
            onClick={() => setShowManage(!showManage)}
            className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100"
          >
            {showManage ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            Manage Parameters
          </button>

          {showManage && (
            <div className="mt-4 space-y-4">
              {/* Set Performance Fee */}
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-4 space-y-3">
                <h4 className="text-sm font-semibold">Set Performance Fee</h4>
                <p className="text-xs text-muted-foreground">Max 50%. Enter percentage (e.g., 5 = 5%)</p>
                <Input type="text" placeholder="e.g. 5" value={perfFee} onChange={(e) => setPerfFee(e.target.value)} />
                <TransactionButton
                  label="Set Performance Fee"
                  onClick={() => {
                    if (!perfFee) return;
                    const feeWad = BigInt(Math.floor(parseFloat(perfFee) * 1e16));
                    perfFeeWrite.write(v2WriteConfigs.setPerformanceFee(vaultAddress as Address, feeWad));
                  }}
                  disabled={!perfFee}
                  isLoading={perfFeeWrite.isLoading}
                  isSuccess={perfFeeWrite.isSuccess}
                  error={perfFeeWrite.error}
                  txHash={perfFeeWrite.txHash}
                />
              </div>

              {/* Set Management Fee */}
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-4 space-y-3">
                <h4 className="text-sm font-semibold">Set Management Fee</h4>
                <p className="text-xs text-muted-foreground">Max 5%. Enter percentage (e.g., 1 = 1%)</p>
                <Input type="text" placeholder="e.g. 1" value={mgmtFee} onChange={(e) => setMgmtFee(e.target.value)} />
                <TransactionButton
                  label="Set Management Fee"
                  onClick={() => {
                    if (!mgmtFee) return;
                    const feeWad = BigInt(Math.floor(parseFloat(mgmtFee) * 1e16));
                    mgmtFeeWrite.write(v2WriteConfigs.setManagementFee(vaultAddress as Address, feeWad));
                  }}
                  disabled={!mgmtFee}
                  isLoading={mgmtFeeWrite.isLoading}
                  isSuccess={mgmtFeeWrite.isSuccess}
                  error={mgmtFeeWrite.error}
                  txHash={mgmtFeeWrite.txHash}
                />
              </div>

              {/* Set Max Rate */}
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-4 space-y-3">
                <h4 className="text-sm font-semibold">Set Max Rate</h4>
                <Input type="text" placeholder="Value in WAD" value={maxRateInput} onChange={(e) => setMaxRateInput(e.target.value)} />
                <TransactionButton
                  label="Set Max Rate"
                  onClick={() => {
                    if (!maxRateInput) return;
                    maxRateWrite.write(v2WriteConfigs.setMaxRate(vaultAddress as Address, BigInt(maxRateInput)));
                  }}
                  disabled={!maxRateInput}
                  isLoading={maxRateWrite.isLoading}
                  isSuccess={maxRateWrite.isSuccess}
                  error={maxRateWrite.error}
                  txHash={maxRateWrite.txHash}
                />
              </div>

              {/* Set Name */}
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-4 space-y-3">
                <h4 className="text-sm font-semibold">Set Vault Name</h4>
                <Input type="text" placeholder="New name" value={newName} onChange={(e) => setNewName(e.target.value)} />
                <TransactionButton
                  label="Set Name"
                  onClick={() => {
                    if (!newName) return;
                    nameWrite.write(v2WriteConfigs.setName(vaultAddress as Address, newName));
                  }}
                  disabled={!newName}
                  isLoading={nameWrite.isLoading}
                  isSuccess={nameWrite.isSuccess}
                  error={nameWrite.error}
                  txHash={nameWrite.txHash}
                />
              </div>

              {/* Set Symbol */}
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-4 space-y-3">
                <h4 className="text-sm font-semibold">Set Vault Symbol</h4>
                <Input type="text" placeholder="New symbol" value={newSymbol} onChange={(e) => setNewSymbol(e.target.value)} />
                <TransactionButton
                  label="Set Symbol"
                  onClick={() => {
                    if (!newSymbol) return;
                    symbolWrite.write(v2WriteConfigs.setSymbol(vaultAddress as Address, newSymbol));
                  }}
                  disabled={!newSymbol}
                  isLoading={symbolWrite.isLoading}
                  isSuccess={symbolWrite.isSuccess}
                  error={symbolWrite.error}
                  txHash={symbolWrite.txHash}
                />
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
