'use client';

import { useState, type ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { useVaultV2Parameters } from '@/lib/hooks/useVaultV2Parameters';
import { useVaultWrite } from '@/lib/hooks/useVaultWrite';
import { TransactionButton } from '@/components/TransactionButton';
import { InlineEdit } from '@/components/morpho/InlineEdit';
import { v2WriteConfigs } from '@/lib/onchain/vault-writes';
import { formatNumber } from '@/lib/format/number';
import type { VaultV2ParametersResponse } from '@/app/api/vaults/v2/[id]/parameters/route';
import type { Address } from 'viem';

interface VaultV2ParametersProps {
  vaultAddress: string;
  preloadedData?: VaultV2ParametersResponse | null;
}

function formatTimelockSummary(timelocks: VaultV2ParametersResponse['timelocks']): string {
  if (timelocks.length === 0) return 'No timelocks configured';
  const instant = timelocks.filter((t) => t.durationSeconds === 0).length;
  const delayed = timelocks.length - instant;
  const parts: string[] = [];
  if (delayed > 0) parts.push(`${delayed} delayed`);
  if (instant > 0) parts.push(`${instant} instant`);
  return `${timelocks.length} functions (${parts.join(', ')})`;
}

export function VaultV2Parameters({ vaultAddress, preloadedData }: VaultV2ParametersProps) {
  const { data: fetchedData, isLoading, error } = useVaultV2Parameters(vaultAddress);
  const data = preloadedData ?? fetchedData;

  if (!preloadedData && isLoading) {
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

  const perfFee =
    data.performanceFeePercent != null ? `${data.performanceFeePercent.toFixed(2)}%` : 'N/A';
  const mgmtFee =
    data.managementFeePercent != null ? `${data.managementFeePercent.toFixed(2)}%` : 'N/A';
  const maxRateDisplay = data.maxRate ? formatNumber(BigInt(data.maxRate)) : 'N/A';

  return (
    <Card>
      <CardHeader>
        <CardTitle>Parameters</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 md:grid-cols-2">
          <ParamTile label="Performance Fee" value={perfFee}>
            <PerformanceFeeForm vaultAddress={vaultAddress} />
          </ParamTile>

          <ParamTile label="Management Fee" value={mgmtFee}>
            <ManagementFeeForm vaultAddress={vaultAddress} />
          </ParamTile>

          <ParamTile label="Timelocks" value={formatTimelockSummary(data.timelocks)}>
            <p className="text-[11px] text-slate-500">
              Per-function durations from the Morpho API. See the Timelocks tab for the full list;
              submit changes via the Pending tab after the delay elapses.
            </p>
          </ParamTile>

          <ParamTile label="Max Rate (per second)" value={maxRateDisplay}>
            <MaxRateForm vaultAddress={vaultAddress} />
          </ParamTile>

          <ParamTile label="Name" value={data.name || 'N/A'}>
            <NameForm vaultAddress={vaultAddress} current={data.name} />
          </ParamTile>

          <ParamTile label="Symbol" value={data.symbol || 'N/A'}>
            <SymbolForm vaultAddress={vaultAddress} current={data.symbol} />
          </ParamTile>

          <ParamTile label="Performance Fee Recipient" value={data.performanceFeeRecipient || 'N/A'}>
            <p className="text-[11px] text-slate-500">Set via timelocked governance on Morpho.</p>
          </ParamTile>

          <ParamTile label="Management Fee Recipient" value={data.managementFeeRecipient || 'N/A'}>
            <p className="text-[11px] text-slate-500">Set via timelocked governance on Morpho.</p>
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
      <p className="text-[11px] text-slate-500">Max 50%. Enter percentage (e.g., 5 = 5%). Timelocked on-chain.</p>
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
      <p className="text-[11px] text-slate-500">Max 5%. Enter percentage (e.g., 1 = 1%). Timelocked on-chain.</p>
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
      <Input type="text" placeholder="Value in WAD per second" value={input} onChange={(e) => setInput(e.target.value)} />
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
