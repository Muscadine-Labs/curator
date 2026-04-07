'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useVault } from '@/lib/hooks/useProtocolStats';
import { useVaultWrite } from '@/lib/hooks/useVaultWrite';
import { ExternalLink, ChevronDown, ChevronUp } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { getScanUrlForChain } from '@/lib/constants';
import { multicallRead } from '@/lib/onchain/client';
import { TransactionButton } from '@/components/TransactionButton';
import { v1WriteConfigs } from '@/lib/onchain/vault-writes';
import type { Address } from 'viem';

interface VaultParametersV1Props {
  vaultAddress: string;
}

const VAULT_PARAMS_ABI = [
  { name: 'publicAllocatorAdmin', type: 'function' as const, stateMutability: 'view' as const, inputs: [] as const, outputs: [{ name: '', type: 'address' }] as const },
  { name: 'publicAllocatorFeeBps', type: 'function' as const, stateMutability: 'view' as const, inputs: [] as const, outputs: [{ name: '', type: 'uint256' }] as const },
  { name: 'timelockDuration', type: 'function' as const, stateMutability: 'view' as const, inputs: [] as const, outputs: [{ name: '', type: 'uint256' }] as const },
] as const;

/** Fetch allocator params and timelock in a single multicall (1 RPC round-trip) */
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

export function VaultParametersV1({ vaultAddress }: VaultParametersV1Props) {
  const { data: vault, isLoading: isVaultLoading } = useVault(vaultAddress);

  const [showManage, setShowManage] = useState(false);
  const [newFeePercent, setNewFeePercent] = useState('');
  const [newFeeRecipient, setNewFeeRecipient] = useState('');
  const [newTimelockSeconds, setNewTimelockSeconds] = useState('');
  const feeWrite = useVaultWrite();
  const feeRecipientWrite = useVaultWrite();
  const timelockWrite = useVaultWrite();
  const acceptTimelockWrite = useVaultWrite();

  const { data: onChainParams, isLoading: isOnChainLoading } = useQuery({
    queryKey: ['vault-parameters-onchain', vaultAddress],
    queryFn: () => fetchVaultParamsOnChain(vaultAddress as Address),
    enabled: !!vaultAddress,
  });

  if (!vault) {
    if (isVaultLoading) {
      return (
        <Card>
          <CardHeader><CardTitle>Parameters</CardTitle></CardHeader>
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
        <CardHeader><CardTitle>Parameters</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-red-600 dark:text-red-400">Failed to load vault data</p>
        </CardContent>
      </Card>
    );
  }

  // Format timelock duration (assuming it's in seconds)
  const formatTimelockDuration = (seconds: number | null): string => {
    if (!seconds) return 'Not available';
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    if (days > 0) {
      return `${days} day${days !== 1 ? 's' : ''}${hours > 0 ? ` ${hours} hour${hours !== 1 ? 's' : ''}` : ''}`;
    }
    return `${hours} hour${hours !== 1 ? 's' : ''}`;
  };

  // Fee recipient (curator) and timelock from vault detail API (GraphQL)
  const feeRecipient = vault.roles?.curator ?? null;
  
  // Vault fee from state (in decimal, e.g., 0.05 = 5%)
  // performanceFeePercent is already in percent units (e.g., 5 = 5%)
  const vaultFeePercent = vault.parameters?.performanceFeePercent ??
    (vault.parameters?.performanceFeeBps ? vault.parameters.performanceFeeBps / 100 : null);

  const parameters: Array<{
    label: string;
    value: string | null | undefined;
    type: 'text' | 'address';
    isLoading?: boolean;
  }> = [
    {
      label: 'Vault Symbol',
      value: vault.symbol || 'N/A',
      type: 'text' as const,
    },
    {
      label: 'Vault Name',
      value: vault.name || 'N/A',
      type: 'text' as const,
    },
    {
      label: 'Fee Recipient',
      value: feeRecipient,
      type: 'address' as const,
    },
    {
      label: 'Public Allocator Admin',
      value: isOnChainLoading ? undefined : (onChainParams?.publicAllocatorAdmin || null),
      type: 'address' as const,
      isLoading: isOnChainLoading,
    },
    {
      label: 'Public Allocator Fee',
      value: isOnChainLoading ? undefined : (onChainParams?.publicAllocatorFeeBps != null
        ? `${(onChainParams.publicAllocatorFeeBps / 100).toFixed(2)}%`
        : null),
      type: 'text' as const,
      isLoading: isOnChainLoading,
    },
    {
      label: 'Vault Fee',
      value: vaultFeePercent != null ? `${vaultFeePercent.toFixed(2)}%` : null,
      type: 'text' as const,
    },
    {
      label: 'Timelock Duration',
      value: (() => {
        // Prefer vault.roles.timelock when it's a number (API/GraphQL returns duration in seconds)
        const fromApi = vault.roles?.timelock;
        const seconds =
          typeof fromApi === 'number'
            ? fromApi
            : (onChainParams?.timelockDuration ?? null);
        return formatTimelockDuration(seconds);
      })(),
      type: 'text' as const,
      isLoading: typeof vault.roles?.timelock !== 'number' && isOnChainLoading,
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Parameters</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          {parameters.map((param) => (
            <div key={param.label} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
              <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">{param.label}</div>
              <div className="mt-2 flex items-center gap-2">
                {param.isLoading ? (
                  <Skeleton className="h-4 w-32" />
                ) : param.type === 'address' && param.value ? (
                  <>
                    <span className="font-mono text-sm">{param.value}</span>
                    <a
                      href={`${getScanUrlForChain(vault.chainId)}/address/${param.value}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                    >
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </>
                ) : (
                  <span className="text-sm text-slate-900 dark:text-slate-100">
                    {param.value || 'Not available'}
                  </span>
                )}
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
              {/* Set Fee */}
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-4 space-y-4">
                <h4 className="text-sm font-semibold">Set Fee</h4>
                <p className="text-xs text-muted-foreground">Max 50%. Value is in percentage (e.g., 5 = 5%)</p>
                <Input
                  type="text"
                  placeholder="e.g. 5"
                  value={newFeePercent}
                  onChange={(e) => setNewFeePercent(e.target.value)}
                />
                <TransactionButton
                  label="Set Fee"
                  onClick={() => {
                    if (!newFeePercent) return;
                    // Convert percentage to WAD: 5% = 5e16
                    const feeWad = BigInt(Math.floor(parseFloat(newFeePercent) * 1e16));
                    const config = v1WriteConfigs.setFee(vaultAddress as Address, feeWad);
                    feeWrite.write(config);
                  }}
                  disabled={!newFeePercent}
                  isLoading={feeWrite.isLoading}
                  isSuccess={feeWrite.isSuccess}
                  error={feeWrite.error}
                  txHash={feeWrite.txHash}
                />
              </div>

              {/* Set Fee Recipient */}
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-4 space-y-4">
                <h4 className="text-sm font-semibold">Set Fee Recipient</h4>
                <Input
                  type="text"
                  placeholder="0x..."
                  value={newFeeRecipient}
                  onChange={(e) => setNewFeeRecipient(e.target.value)}
                />
                <TransactionButton
                  label="Set Fee Recipient"
                  onClick={() => {
                    if (!newFeeRecipient) return;
                    const config = v1WriteConfigs.setFeeRecipient(vaultAddress as Address, newFeeRecipient as Address);
                    feeRecipientWrite.write(config);
                  }}
                  disabled={!newFeeRecipient}
                  isLoading={feeRecipientWrite.isLoading}
                  isSuccess={feeRecipientWrite.isSuccess}
                  error={feeRecipientWrite.error}
                  txHash={feeRecipientWrite.txHash}
                />
              </div>

              {/* Submit Timelock */}
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-4 space-y-4">
                <h4 className="text-sm font-semibold">Submit Timelock</h4>
                <p className="text-xs text-muted-foreground">Duration in seconds</p>
                <Input
                  type="text"
                  placeholder="e.g. 86400 (1 day)"
                  value={newTimelockSeconds}
                  onChange={(e) => setNewTimelockSeconds(e.target.value)}
                />
                <TransactionButton
                  label="Submit Timelock"
                  onClick={() => {
                    if (!newTimelockSeconds) return;
                    const config = v1WriteConfigs.submitTimelock(vaultAddress as Address, BigInt(newTimelockSeconds));
                    timelockWrite.write(config);
                  }}
                  disabled={!newTimelockSeconds}
                  isLoading={timelockWrite.isLoading}
                  isSuccess={timelockWrite.isSuccess}
                  error={timelockWrite.error}
                  txHash={timelockWrite.txHash}
                />
              </div>

              {/* Accept Timelock */}
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-4 space-y-4">
                <h4 className="text-sm font-semibold">Accept Timelock</h4>
                <p className="text-xs text-muted-foreground">Accept a pending timelock after its delay has elapsed.</p>
                <TransactionButton
                  label="Accept Timelock"
                  onClick={() => {
                    const config = v1WriteConfigs.acceptTimelock(vaultAddress as Address);
                    acceptTimelockWrite.write(config);
                  }}
                  isLoading={acceptTimelockWrite.isLoading}
                  isSuccess={acceptTimelockWrite.isSuccess}
                  error={acceptTimelockWrite.error}
                  txHash={acceptTimelockWrite.txHash}
                />
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

