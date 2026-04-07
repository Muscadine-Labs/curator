'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { AddressBadge } from '@/components/AddressBadge';
import { TransactionButton } from '@/components/TransactionButton';
import { useVaultV2Governance } from '@/lib/hooks/useVaultV2Governance';
import { useVaultWrite } from '@/lib/hooks/useVaultWrite';
import { v2WriteConfigs } from '@/lib/onchain/vault-writes';
import type { VaultV2GovernanceResponse } from '@/app/api/vaults/v2/[id]/governance/route';
import type { Address } from 'viem';

interface VaultV2RolesProps {
  vaultAddress: string;
  preloadedData?: VaultV2GovernanceResponse | null;
}

export function VaultV2Roles({ vaultAddress, preloadedData }: VaultV2RolesProps) {
  const { data: fetchedData, isLoading, error } = useVaultV2Governance(vaultAddress);
  const data = preloadedData ?? fetchedData;

  const [showManage, setShowManage] = useState(false);
  const [newOwner, setNewOwner] = useState('');
  const [newCurator, setNewCurator] = useState('');
  const [sentinelAddr, setSentinelAddr] = useState('');
  const [sentinelGrant, setSentinelGrant] = useState(true);
  const ownerWrite = useVaultWrite();
  const curatorWrite = useVaultWrite();
  const sentinelWrite = useVaultWrite();

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

  if (error || !data) {
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Roles</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <RoleTile title="Owner" address={data.owner} />
        <RoleTile title="Curator" address={data.curator} />
        <RoleList title="Allocators" addresses={data.allocators} emptyText="No allocators configured" />
        <RoleList title="Sentinels" addresses={data.sentinels} emptyText="No sentinels configured" />

        {/* Manage Section */}
        <div className="border-t pt-4 col-span-full">
          <button
            onClick={() => setShowManage(!showManage)}
            className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100"
          >
            {showManage ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            Manage Roles
          </button>

          {showManage && (
            <div className="mt-4 space-y-4">
              {/* Set Owner */}
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-4 space-y-3">
                <h4 className="text-sm font-semibold">Set Owner</h4>
                <Input type="text" placeholder="0x..." value={newOwner} onChange={(e) => setNewOwner(e.target.value)} />
                <TransactionButton
                  label="Set Owner"
                  variant="destructive"
                  onClick={() => { if (!newOwner) return; ownerWrite.write(v2WriteConfigs.setOwner(vaultAddress as Address, newOwner as Address)); }}
                  disabled={!newOwner}
                  isLoading={ownerWrite.isLoading}
                  isSuccess={ownerWrite.isSuccess}
                  error={ownerWrite.error}
                  txHash={ownerWrite.txHash}
                />
              </div>

              {/* Set Curator */}
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-4 space-y-3">
                <h4 className="text-sm font-semibold">Set Curator</h4>
                <Input type="text" placeholder="0x..." value={newCurator} onChange={(e) => setNewCurator(e.target.value)} />
                <TransactionButton
                  label="Set Curator"
                  onClick={() => { if (!newCurator) return; curatorWrite.write(v2WriteConfigs.setCurator(vaultAddress as Address, newCurator as Address)); }}
                  disabled={!newCurator}
                  isLoading={curatorWrite.isLoading}
                  isSuccess={curatorWrite.isSuccess}
                  error={curatorWrite.error}
                  txHash={curatorWrite.txHash}
                />
              </div>

              {/* Set Sentinel */}
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-4 space-y-3">
                <h4 className="text-sm font-semibold">Set Sentinel</h4>
                <Input type="text" placeholder="0x..." value={sentinelAddr} onChange={(e) => setSentinelAddr(e.target.value)} />
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setSentinelGrant(true)}
                    className={`px-3 py-1 rounded-md text-xs font-medium ${sentinelGrant ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'}`}
                  >
                    Grant
                  </button>
                  <button
                    onClick={() => setSentinelGrant(false)}
                    className={`px-3 py-1 rounded-md text-xs font-medium ${!sentinelGrant ? 'bg-destructive text-white' : 'bg-secondary text-secondary-foreground'}`}
                  >
                    Revoke
                  </button>
                </div>
                <TransactionButton
                  label={sentinelGrant ? 'Grant Sentinel' : 'Revoke Sentinel'}
                  onClick={() => { if (!sentinelAddr) return; sentinelWrite.write(v2WriteConfigs.setIsSentinel(vaultAddress as Address, sentinelAddr as Address, sentinelGrant)); }}
                  disabled={!sentinelAddr}
                  isLoading={sentinelWrite.isLoading}
                  isSuccess={sentinelWrite.isSuccess}
                  error={sentinelWrite.error}
                  txHash={sentinelWrite.txHash}
                />
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function RoleTile({ title, address }: { title: string; address: string | null }) {
  return (
    <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
      <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}</p>
      {address ? (
        <div className="mt-2">
          <AddressBadge address={address} truncate={false} />
        </div>
      ) : (
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Not set</p>
      )}
    </div>
  );
}

function RoleList({
  title,
  addresses,
  emptyText,
}: {
  title: string;
  addresses: string[];
  emptyText: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}</p>
        <Badge variant="outline" className="text-xs">
          {addresses.length}
        </Badge>
      </div>
      {addresses.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{emptyText}</p>
      ) : (
        <div className="mt-2 space-y-2">
          {addresses.map((addr) => (
            <AddressBadge key={addr} address={addr} truncate={false} />
          ))}
        </div>
      )}
    </div>
  );
}

