'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { AddressBadge } from '@/components/AddressBadge';
import { TransactionButton } from '@/components/TransactionButton';
import { useVaultRoles } from '@/lib/hooks/useVaultRoles';
import { useVaultWrite } from '@/lib/hooks/useVaultWrite';
import { v1WriteConfigs } from '@/lib/onchain/vault-writes';
import type { Address } from 'viem';
import type { VaultRolesData } from '@/lib/hooks/useVaultRoles';

interface VaultRolesV1Props {
  vaultAddress: Address | string;
  preloadedData?: VaultRolesData | null;
}

export function VaultRolesV1({ vaultAddress, preloadedData }: VaultRolesV1Props) {
  const { data: fetchedRoles, isLoading, error } = useVaultRoles(vaultAddress as Address);
  const roles = preloadedData ?? fetchedRoles;

  const [showManage, setShowManage] = useState(false);
  const [newCurator, setNewCurator] = useState('');
  const [newGuardian, setNewGuardian] = useState('');
  const [allocatorAddr, setAllocatorAddr] = useState('');
  const [allocatorEnabled, setAllocatorEnabled] = useState(true);
  const [newOwner, setNewOwner] = useState('');
  const curatorWrite = useVaultWrite();
  const guardianWrite = useVaultWrite();
  const acceptGuardianWrite = useVaultWrite();
  const allocatorWrite = useVaultWrite();
  const ownershipWrite = useVaultWrite();

  if (!preloadedData && isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Roles</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error || !roles) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Roles</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-red-600 dark:text-red-400">
            Failed to load roles: {error instanceof Error ? error.message : 'Unknown error'}
          </p>
        </CardContent>
      </Card>
    );
  }

  const roleTiles = [
    { label: 'Owner', address: roles.owner },
    { label: 'Curator', address: roles.curator },
    { label: 'Guardian', address: roles.guardian },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Roles</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          {roleTiles.map((role) => (
            <div key={role.label} className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
              <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">{role.label}</p>
              {role.address ? (
                <div className="mt-2">
                  <AddressBadge address={role.address} truncate={false} />
                </div>
              ) : (
                <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Not set</p>
              )}
            </div>
          ))}
        </div>

        <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Allocators</p>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {roles.allocators.length} {roles.allocators.length === 1 ? 'allocator' : 'allocators'}
            </span>
          </div>
          {roles.allocators.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">No allocators configured</p>
          ) : (
            <div className="mt-2 space-y-2">
              {roles.allocators.map((addr) => (
                <AddressBadge key={addr} address={addr} truncate={false} />
              ))}
            </div>
          )}
        </div>

        {/* Manage Section */}
        <div className="border-t pt-4">
          <button
            onClick={() => setShowManage(!showManage)}
            className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100"
          >
            {showManage ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            Manage Roles
          </button>

          {showManage && (
            <div className="mt-4 space-y-4">
              {/* Set Curator */}
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-4 space-y-3">
                <h4 className="text-sm font-semibold">Set Curator</h4>
                <Input type="text" placeholder="0x..." value={newCurator} onChange={(e) => setNewCurator(e.target.value)} />
                <TransactionButton
                  label="Set Curator"
                  onClick={() => { if (!newCurator) return; curatorWrite.write(v1WriteConfigs.setCurator(vaultAddress as Address, newCurator as Address)); }}
                  disabled={!newCurator}
                  isLoading={curatorWrite.isLoading}
                  isSuccess={curatorWrite.isSuccess}
                  error={curatorWrite.error}
                  txHash={curatorWrite.txHash}
                />
              </div>

              {/* Submit Guardian */}
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-4 space-y-3">
                <h4 className="text-sm font-semibold">Submit Guardian</h4>
                <Input type="text" placeholder="0x..." value={newGuardian} onChange={(e) => setNewGuardian(e.target.value)} />
                <TransactionButton
                  label="Submit Guardian"
                  onClick={() => { if (!newGuardian) return; guardianWrite.write(v1WriteConfigs.submitGuardian(vaultAddress as Address, newGuardian as Address)); }}
                  disabled={!newGuardian}
                  isLoading={guardianWrite.isLoading}
                  isSuccess={guardianWrite.isSuccess}
                  error={guardianWrite.error}
                  txHash={guardianWrite.txHash}
                />
              </div>

              {/* Accept Guardian */}
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-4 space-y-3">
                <h4 className="text-sm font-semibold">Accept Guardian</h4>
                <p className="text-xs text-muted-foreground">Accept a pending guardian after timelock.</p>
                <TransactionButton
                  label="Accept Guardian"
                  onClick={() => { acceptGuardianWrite.write(v1WriteConfigs.acceptGuardian(vaultAddress as Address)); }}
                  isLoading={acceptGuardianWrite.isLoading}
                  isSuccess={acceptGuardianWrite.isSuccess}
                  error={acceptGuardianWrite.error}
                  txHash={acceptGuardianWrite.txHash}
                />
              </div>

              {/* Set Allocator */}
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-4 space-y-3">
                <h4 className="text-sm font-semibold">Add / Remove Allocator</h4>
                <Input type="text" placeholder="0x..." value={allocatorAddr} onChange={(e) => setAllocatorAddr(e.target.value)} />
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setAllocatorEnabled(true)}
                    className={`px-3 py-1 rounded-md text-xs font-medium ${allocatorEnabled ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'}`}
                  >
                    Grant
                  </button>
                  <button
                    onClick={() => setAllocatorEnabled(false)}
                    className={`px-3 py-1 rounded-md text-xs font-medium ${!allocatorEnabled ? 'bg-destructive text-white' : 'bg-secondary text-secondary-foreground'}`}
                  >
                    Revoke
                  </button>
                </div>
                <TransactionButton
                  label={allocatorEnabled ? 'Grant Allocator' : 'Revoke Allocator'}
                  onClick={() => { if (!allocatorAddr) return; allocatorWrite.write(v1WriteConfigs.setIsAllocator(vaultAddress as Address, allocatorAddr as Address, allocatorEnabled)); }}
                  disabled={!allocatorAddr}
                  isLoading={allocatorWrite.isLoading}
                  isSuccess={allocatorWrite.isSuccess}
                  error={allocatorWrite.error}
                  txHash={allocatorWrite.txHash}
                />
              </div>

              {/* Transfer Ownership */}
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-4 space-y-3">
                <h4 className="text-sm font-semibold">Transfer Ownership</h4>
                <Input type="text" placeholder="0x..." value={newOwner} onChange={(e) => setNewOwner(e.target.value)} />
                <TransactionButton
                  label="Transfer Ownership"
                  variant="destructive"
                  onClick={() => { if (!newOwner) return; ownershipWrite.write(v1WriteConfigs.transferOwnership(vaultAddress as Address, newOwner as Address)); }}
                  disabled={!newOwner}
                  isLoading={ownershipWrite.isLoading}
                  isSuccess={ownershipWrite.isSuccess}
                  error={ownershipWrite.error}
                  txHash={ownershipWrite.txHash}
                />
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

