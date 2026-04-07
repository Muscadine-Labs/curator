'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AddressBadge } from './AddressBadge';
import { Plus, X, Loader2 } from 'lucide-react';
import { Address, isAddress } from 'viem';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { v1WriteConfigs } from '@/lib/onchain/vault-writes';
import { BASE_CHAIN_ID, getScanUrlForChain } from '@/lib/constants';
import { useVaultRoles } from '@/lib/hooks/useVaultRoles';
import { logger } from '@/lib/utils/logger';

interface AllocatorListProps {
  vaultAddress: Address;
  chainId?: number;
}

export function AllocatorList({ vaultAddress, chainId = BASE_CHAIN_ID }: AllocatorListProps) {
  const { address: connectedAddress, isConnected } = useAccount();
  const { data: roles, isLoading } = useVaultRoles(vaultAddress, chainId);
  
  const [newAllocatorAddress, setNewAllocatorAddress] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  // Write hooks for allocator management
  const { writeContract: setIsAllocator, data: allocatorTxHash, isPending: isSettingAllocator } = useWriteContract();

  // Wait for transaction receipt
  const { isLoading: isAllocatorConfirming } = useWaitForTransactionReceipt({ hash: allocatorTxHash });

  // Check if connected wallet has permission (owner or curator can manage allocators)
  const canManageAllocators = isConnected && connectedAddress && (
    roles?.owner?.toLowerCase() === connectedAddress.toLowerCase() ||
    roles?.curator?.toLowerCase() === connectedAddress.toLowerCase()
  );

  const handleAddAllocator = async () => {
    const address = newAllocatorAddress.trim();
    if (!address || !isAddress(address)) {
      alert('Please enter a valid Ethereum address');
      return;
    }

    if (roles?.allocators.some(addr => addr.toLowerCase() === address.toLowerCase())) {
      alert('This address is already an allocator');
      return;
    }

    setIsAdding(true);
    try {
      const config = v1WriteConfigs.setIsAllocator(vaultAddress, address as Address, true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setIsAllocator(config as any);
      setNewAllocatorAddress('');
    } catch (error) {
      logger.error('Failed to add allocator', error instanceof Error ? error : new Error(String(error)), {
        vaultAddress,
        allocatorAddress: address,
      });
      alert('Failed to add allocator. Please try again.');
    } finally {
      setIsAdding(false);
    }
  };

  const handleRemoveAllocator = async (allocatorAddress: Address) => {
    if (!confirm(`Are you sure you want to remove ${allocatorAddress} as an allocator?`)) {
      return;
    }

    try {
      const config = v1WriteConfigs.setIsAllocator(vaultAddress, allocatorAddress, false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setIsAllocator(config as any);
    } catch (error) {
      logger.error('Failed to remove allocator', error instanceof Error ? error : new Error(String(error)), {
        vaultAddress,
        allocatorAddress,
      });
      alert('Failed to remove allocator. Please try again.');
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Allocators</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">Loading allocators...</div>
        </CardContent>
      </Card>
    );
  }

  if (!roles) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Allocators</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">Failed to load allocators</div>
        </CardContent>
      </Card>
    );
  }

  const isPending = isSettingAllocator || isAllocatorConfirming;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Allocators</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {roles.allocators.length > 0 ? (
          <div className="space-y-3">
            {roles.allocators.map((allocator, index) => (
              <div key={index} className="flex items-center justify-between p-2 rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">Allocator</Badge>
                  <AddressBadge 
                    address={allocator} 
                    scanUrl={`${getScanUrlForChain(chainId)}/address/${allocator}`}
                  />
                </div>
                {canManageAllocators && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleRemoveAllocator(allocator)}
                    disabled={isPending}
                  >
                    {isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <X className="h-4 w-4" />
                    )}
                  </Button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground py-4 text-center">
            No allocators configured
          </div>
        )}

        {canManageAllocators && (
          <div className="pt-4 border-t space-y-2">
            <div className="flex items-center gap-2">
              <Input
                value={newAllocatorAddress}
                onChange={(e) => setNewAllocatorAddress(e.target.value)}
                placeholder="0x..."
                className="flex-1 font-mono text-xs"
                disabled={isPending}
              />
              <Button
                size="sm"
                onClick={handleAddAllocator}
                disabled={isPending || !newAllocatorAddress.trim() || isAdding}
              >
                {isPending || isAdding ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-1" />
                    Adding...
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4 mr-1" />
                    Add
                  </>
                )}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Add a new allocator address. Allocators can manage vault allocations.
            </p>
          </div>
        )}

        {!isConnected && (
          <div className="text-xs text-muted-foreground pt-2 border-t">
            Connect your wallet to manage allocators
          </div>
        )}
      </CardContent>
    </Card>
  );
}
