'use client';

import { useState, type ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { useQuery } from '@tanstack/react-query';
import { useVaultWrite } from '@/lib/hooks/useVaultWrite';
import { TransactionButton } from '@/components/TransactionButton';
import { InlineEdit } from '@/components/morpho/InlineEdit';
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Parameters</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 md:grid-cols-2">
          <ParamTile label="Performance Fee" value={data.performanceFee != null ? `${data.performanceFee.toFixed(2)}%` : 'N/A'}>
            <PerformanceFeeForm vaultAddress={vaultAddress} />
          </ParamTile>

          <ParamTile label="Management Fee" value={data.managementFee != null ? `${data.managementFee.toFixed(2)}%` : 'N/A'}>
            <ManagementFeeForm vaultAddress={vaultAddress} />
          </ParamTile>

          <ParamTile label="Timelock" value={formatDuration(data.timelock)}>
            <p className="text-[11px] text-slate-500">
              Timelock changes must be submitted on-chain and accepted via the governance flow.
            </p>
          </ParamTile>

          <ParamTile label="Max Rate" value={data.maxRate ?? 'N/A'}>
            <MaxRateForm vaultAddress={vaultAddress} />
          </ParamTile>

          <ParamTile label="Name" value={data.name ?? 'N/A'}>
            <NameForm vaultAddress={vaultAddress} current={data.name} />
          </ParamTile>

          <ParamTile label="Symbol" value={data.symbol ?? 'N/A'}>
            <SymbolForm vaultAddress={vaultAddress} current={data.symbol} />
          </ParamTile>
        </div>
      </CardContent>
    </Card>
  );
}

function ParamTile({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <InlineEdit label={`Edit ${label}`} form={() => <>{children}</>}>
        <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</div>
        <div className="mt-2 text-sm font-semibold text-slate-900 dark:text-slate-100">{value}</div>
      </InlineEdit>
    </div>
  );
}

function PerformanceFeeForm({ vaultAddress }: { vaultAddress: string }) {
  const [input, setInput] = useState('');
  const write = useVaultWrite();
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-slate-500">Max 50%. Enter percentage (e.g., 5 = 5%).</p>
      <Input type="text" placeholder="e.g. 5" value={input} onChange={(e) => setInput(e.target.value)} />
      <TransactionButton
        label="Set Performance Fee"
        onClick={() => {
          if (!input) return;
          const feeWad = BigInt(Math.floor(parseFloat(input) * 1e16));
          write.write(v2WriteConfigs.setPerformanceFee(vaultAddress as Address, feeWad));
        }}
        disabled={!input}
        isLoading={write.isLoading}
        isSuccess={write.isSuccess}
        error={write.error}
        txHash={write.txHash}
      />
    </div>
  );
}

function ManagementFeeForm({ vaultAddress }: { vaultAddress: string }) {
  const [input, setInput] = useState('');
  const write = useVaultWrite();
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-slate-500">Max 5%. Enter percentage (e.g., 1 = 1%).</p>
      <Input type="text" placeholder="e.g. 1" value={input} onChange={(e) => setInput(e.target.value)} />
      <TransactionButton
        label="Set Management Fee"
        onClick={() => {
          if (!input) return;
          const feeWad = BigInt(Math.floor(parseFloat(input) * 1e16));
          write.write(v2WriteConfigs.setManagementFee(vaultAddress as Address, feeWad));
        }}
        disabled={!input}
        isLoading={write.isLoading}
        isSuccess={write.isSuccess}
        error={write.error}
        txHash={write.txHash}
      />
    </div>
  );
}

function MaxRateForm({ vaultAddress }: { vaultAddress: string }) {
  const [input, setInput] = useState('');
  const write = useVaultWrite();
  return (
    <div className="space-y-2">
      <Input type="text" placeholder="Value in WAD" value={input} onChange={(e) => setInput(e.target.value)} />
      <TransactionButton
        label="Set Max Rate"
        onClick={() => {
          if (!input) return;
          write.write(v2WriteConfigs.setMaxRate(vaultAddress as Address, BigInt(input)));
        }}
        disabled={!input}
        isLoading={write.isLoading}
        isSuccess={write.isSuccess}
        error={write.error}
        txHash={write.txHash}
      />
    </div>
  );
}

function NameForm({ vaultAddress, current }: { vaultAddress: string; current: string | null }) {
  const [input, setInput] = useState(current ?? '');
  const write = useVaultWrite();
  return (
    <div className="space-y-2">
      <Input type="text" placeholder="New name" value={input} onChange={(e) => setInput(e.target.value)} />
      <TransactionButton
        label="Set Name"
        onClick={() => {
          if (!input) return;
          write.write(v2WriteConfigs.setName(vaultAddress as Address, input));
        }}
        disabled={!input}
        isLoading={write.isLoading}
        isSuccess={write.isSuccess}
        error={write.error}
        txHash={write.txHash}
      />
    </div>
  );
}

function SymbolForm({ vaultAddress, current }: { vaultAddress: string; current: string | null }) {
  const [input, setInput] = useState(current ?? '');
  const write = useVaultWrite();
  return (
    <div className="space-y-2">
      <Input type="text" placeholder="New symbol" value={input} onChange={(e) => setInput(e.target.value)} />
      <TransactionButton
        label="Set Symbol"
        onClick={() => {
          if (!input) return;
          write.write(v2WriteConfigs.setSymbol(vaultAddress as Address, input));
        }}
        disabled={!input}
        isLoading={write.isLoading}
        isSuccess={write.isSuccess}
        error={write.error}
        txHash={write.txHash}
      />
    </div>
  );
}
