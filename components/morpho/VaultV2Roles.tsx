'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { AddressBadge } from '@/components/AddressBadge';
import { useVaultV2Governance } from '@/lib/hooks/useVaultV2Governance';
import type { VaultV2GovernanceResponse } from '@/app/api/vaults/v2/[id]/governance/route';

interface VaultV2RolesProps {
  vaultAddress: string;
  preloadedData?: VaultV2GovernanceResponse | null;
}

export function VaultV2Roles({ vaultAddress, preloadedData }: VaultV2RolesProps) {
  const { data: fetchedData, isLoading, error } = useVaultV2Governance(vaultAddress);
  const data = preloadedData ?? fetchedData;

  if (!preloadedData && isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Vault Addresses</CardTitle>
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
          <CardTitle>Vault Addresses</CardTitle>
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
        <CardTitle>Vault Addresses</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <RoleBlock
          title="Owner Address"
          description="Administrative role with the authority to assign and manage vault roles"
          address={data.owner}
        />
        <RoleBlock
          title="Curator Address"
          description="Configures vault parameters and sets risk configuration"
          address={data.curator}
        />
        <AddressListBlock
          title="Allocator Addresses"
          description="Addresses authorized to rebalance vault allocations"
          addresses={data.allocators}
        />
        <AddressListBlock
          title="Sentinel Addresses"
          description="Emergency responders who can deallocate and decrease caps"
          addresses={data.sentinels}
        />
      </CardContent>
    </Card>
  );
}

function RoleBlock({
  title,
  description,
  address,
}: {
  title: string;
  description: string;
  address: string | null;
}) {
  return (
    <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</p>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{description}</p>
      <div className="mt-3">
        {address ? (
          <AddressBadge address={address} truncate={false} />
        ) : (
          <p className="text-sm text-slate-500 dark:text-slate-400">Not set</p>
        )}
      </div>
    </div>
  );
}

function AddressListBlock({
  title,
  description,
  addresses,
}: {
  title: string;
  description: string;
  addresses: string[];
}) {
  return (
    <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</p>
        <Badge variant="outline" className="text-xs">
          {addresses.length}
        </Badge>
      </div>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{description}</p>
      {addresses.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">None configured</p>
      ) : (
        <div className="mt-3 space-y-2">
          {addresses.map((addr) => (
            <AddressBadge key={addr} address={addr} truncate={false} />
          ))}
        </div>
      )}
    </div>
  );
}
