'use client';

import { useState, type ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { useVault } from '@/lib/hooks/useProtocolStats';
import { useVaultWrite } from '@/lib/hooks/useVaultWrite';
import { ExternalLink } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { getScanUrlForChain } from '@/lib/constants';
import { multicallRead } from '@/lib/onchain/client';
import { TransactionButton } from '@/components/TransactionButton';
import { InlineEdit } from '@/components/morpho/InlineEdit';
import { v1WriteConfigs } from '@/lib/onchain/vault-writes';
import { isAddress, type Address } from 'viem';

interface VaultParametersV1Props {
  vaultAddress: string;
}

const VAULT_PARAMS_ABI = [
  { name: 'publicAllocatorAdmin', type: 'function' as const, stateMutability: 'view' as const, inputs: [] as const, outputs: [{ name: '', type: 'address' }] as const },
  { name: 'publicAllocatorFeeBps', type: 'function' as const, stateMutability: 'view' as const, inputs: [] as const, outputs: [{ name: '', type: 'uint256' }] as const },
  { name: 'timelockDuration', type: 'function' as const, stateMutability: 'view' as const, inputs: [] as const, outputs: [{ name: '', type: 'uint256' }] as const },
] as const;

async function fetchVaultParamsOnChain(vaultAddress: Address) {
  const [publicAllocatorAdmin, publicAllocatorFeeBps, timelockDuration] = await multicallRead<Address | bigint>([
    { address: vaultAddress, abi: VAULT_PARAMS_ABI, functionName: 'publicAllocatorAdmin' },
    { address: vaultAddress, abi: VAULT_PARAMS_ABI, functionName: 'publicAllocatorFeeBps' },
    { address: vaultAddress, abi: VAULT_PARAMS_ABI, functionName: 'timelockDuration' },
  ]);

  return {
    publicAllocatorAdmin: publicAllocatorAdmin as Address | null,
    publicAllocatorFeeBps: publicAllocatorFeeBps != null ? Number(publicAllocatorFeeBps) : null,
    timelockDuration: timelockDuration != null ? Number(timelockDuration) : null,
  };
}

function formatTimelockDuration(seconds: number | null): string {
  if (!seconds) return 'Not available';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  if (days > 0) {
    return `${days} day${days !== 1 ? 's' : ''}${hours > 0 ? ` ${hours} hour${hours !== 1 ? 's' : ''}` : ''}`;
  }
  return `${hours} hour${hours !== 1 ? 's' : ''}`;
}

export function VaultParametersV1({ vaultAddress }: VaultParametersV1Props) {
  const { data: vault, isLoading: isVaultLoading } = useVault(vaultAddress);

  const { data: onChainParams, isLoading: isOnChainLoading } = useQuery({
    queryKey: ['vault-parameters-onchain', vaultAddress],
    queryFn: () => fetchVaultParamsOnChain(vaultAddress as Address),
    enabled: !!vaultAddress,
  });

  if (!vault) {
    if (isVaultLoading) {
      return (
        <Card>
          <CardHeader>
            <CardTitle>Parameters</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
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
          <p className="text-sm text-red-600 dark:text-red-400">Failed to load vault data</p>
        </CardContent>
      </Card>
    );
  }

  const feeRecipient = vault.roles?.curator ?? null;
  const vaultFeePercent =
    vault.parameters?.performanceFeePercent ??
    (vault.parameters?.performanceFeeBps ? vault.parameters.performanceFeeBps / 100 : null);
  const timelockSeconds =
    typeof vault.roles?.timelock === 'number' ? vault.roles.timelock : (onChainParams?.timelockDuration ?? null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Parameters</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 md:grid-cols-2">
          <ReadOnlyTile label="Vault Symbol" value={vault.symbol || 'N/A'} />
          <ReadOnlyTile label="Vault Name" value={vault.name || 'N/A'} />

          <EditableTile
            label="Fee Recipient"
            valueNode={
              feeRecipient ? (
                <AddressValue address={feeRecipient} chainId={vault.chainId} />
              ) : (
                'Not available'
              )
            }
            form={() => <FeeRecipientForm vaultAddress={vaultAddress} />}
          />

          <ReadOnlyTile
            label="Public Allocator Admin"
            value={
              isOnChainLoading
                ? undefined
                : onChainParams?.publicAllocatorAdmin || null
            }
            address
            chainId={vault.chainId}
            isLoading={isOnChainLoading}
          />

          <ReadOnlyTile
            label="Public Allocator Fee"
            value={
              isOnChainLoading
                ? undefined
                : onChainParams?.publicAllocatorFeeBps != null
                  ? `${(onChainParams.publicAllocatorFeeBps / 100).toFixed(2)}%`
                  : null
            }
            isLoading={isOnChainLoading}
          />

          <EditableTile
            label="Vault Fee"
            valueNode={vaultFeePercent != null ? `${vaultFeePercent.toFixed(2)}%` : 'Not available'}
            form={() => <FeeForm vaultAddress={vaultAddress} />}
          />

          <EditableTile
            label="Timelock Duration"
            valueNode={formatTimelockDuration(timelockSeconds)}
            form={() => <TimelockForm vaultAddress={vaultAddress} />}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function ReadOnlyTile({
  label,
  value,
  address,
  chainId,
  isLoading,
}: {
  label: string;
  value: string | null | undefined;
  address?: boolean;
  chainId?: number;
  isLoading?: boolean;
}) {
  return (
    <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</div>
      <div className="mt-2 flex items-center gap-2">
        {isLoading ? (
          <Skeleton className="h-4 w-32" />
        ) : address && value ? (
          <AddressValue address={value} chainId={chainId ?? 1} />
        ) : (
          <span className="text-sm text-slate-900 dark:text-slate-100">{value || 'Not available'}</span>
        )}
      </div>
    </div>
  );
}

function EditableTile({
  label,
  valueNode,
  form,
}: {
  label: string;
  valueNode: ReactNode;
  form: () => ReactNode;
}) {
  return (
    <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <InlineEdit label={`Edit ${label}`} form={() => <>{form()}</>}>
        <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</div>
        <div className="mt-2 flex items-center gap-2 text-sm text-slate-900 dark:text-slate-100">{valueNode}</div>
      </InlineEdit>
    </div>
  );
}

function AddressValue({ address, chainId }: { address: string; chainId: number }) {
  return (
    <>
      <span className="font-mono text-sm">{address}</span>
      <a
        href={`${getScanUrlForChain(chainId)}/address/${address}`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
      >
        <ExternalLink className="h-3 w-3" />
      </a>
    </>
  );
}

function FeeForm({ vaultAddress }: { vaultAddress: string }) {
  const [input, setInput] = useState('');
  const write = useVaultWrite();
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-slate-500">Max 50%. Enter percentage (e.g., 5 = 5%).</p>
      <Input type="text" placeholder="e.g. 5" value={input} onChange={(e) => setInput(e.target.value)} />
      <TransactionButton
        label="Set Fee"
        onClick={() => {
          if (!input) return;
          const feeWad = BigInt(Math.floor(parseFloat(input) * 1e16));
          write.write(v1WriteConfigs.setFee(vaultAddress as Address, feeWad));
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

function FeeRecipientForm({ vaultAddress }: { vaultAddress: string }) {
  const [input, setInput] = useState('');
  const write = useVaultWrite();
  const valid = isAddress(input);
  return (
    <div className="space-y-2">
      <Input type="text" placeholder="0x…" value={input} onChange={(e) => setInput(e.target.value)} />
      <TransactionButton
        label="Set Fee Recipient"
        onClick={() => {
          if (!valid) return;
          write.write(v1WriteConfigs.setFeeRecipient(vaultAddress as Address, input as Address));
        }}
        disabled={!valid}
        isLoading={write.isLoading}
        isSuccess={write.isSuccess}
        error={write.error}
        txHash={write.txHash}
      />
    </div>
  );
}

function TimelockForm({ vaultAddress }: { vaultAddress: string }) {
  const [input, setInput] = useState('');
  const submit = useVaultWrite();
  const accept = useVaultWrite();
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <label className="text-[11px] text-slate-500">Submit new timelock (seconds).</label>
        <Input
          type="text"
          placeholder="e.g. 86400 (1 day)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <TransactionButton
          label="Submit Timelock"
          onClick={() => {
            if (!input) return;
            submit.write(v1WriteConfigs.submitTimelock(vaultAddress as Address, BigInt(input)));
          }}
          disabled={!input}
          isLoading={submit.isLoading}
          isSuccess={submit.isSuccess}
          error={submit.error}
          txHash={submit.txHash}
        />
      </div>
      <div className="border-t border-slate-200 pt-2 dark:border-slate-700">
        <p className="mb-2 text-[11px] text-slate-500">Accept a pending timelock once the delay has elapsed.</p>
        <TransactionButton
          label="Accept Timelock"
          onClick={() => accept.write(v1WriteConfigs.acceptTimelock(vaultAddress as Address))}
          isLoading={accept.isLoading}
          isSuccess={accept.isSuccess}
          error={accept.error}
          txHash={accept.txHash}
        />
      </div>
    </div>
  );
}
