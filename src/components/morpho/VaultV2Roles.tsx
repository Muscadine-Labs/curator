'use client';

import { Skeleton } from '@/components/ui/skeleton';
import { AddressBadge } from '@/components/AddressBadge';
import { useVaultV2Governance } from '@/lib/hooks/useVaultV2Governance';
import type { VaultV2GovernanceResponse } from '@/app/api/vaults/[id]/governance/route';
import {
  CuratorErrorText,
  CuratorKvList,
  CuratorKvRow,
  CuratorPanel,
} from '@/components/morpho/CuratorChrome';

interface VaultV2RolesProps {
  vaultAddress: string;
  preloadedData?: VaultV2GovernanceResponse | null;
}

function AddressOrDash({ address }: { address: string | null }) {
  if (!address) return <span className="font-normal text-muted-foreground">—</span>;
  return <AddressBadge address={address} truncate label="auto" />;
}

function AddressList({ addresses }: { addresses: string[] }) {
  if (addresses.length === 0) {
    return <span className="font-normal text-muted-foreground">None</span>;
  }
  return (
    <div className="flex flex-col items-start gap-1.5 sm:items-end">
      {addresses.map((addr) => (
        <AddressBadge key={addr} address={addr} truncate label="auto" />
      ))}
    </div>
  );
}

export function VaultV2Roles({ vaultAddress, preloadedData }: VaultV2RolesProps) {
  const { data: fetchedData, isLoading, error } = useVaultV2Governance(vaultAddress);
  const data = preloadedData ?? fetchedData;

  if (!preloadedData && isLoading) {
    return (
      <CuratorPanel title="Roles">
        <div className="space-y-3 p-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </CuratorPanel>
    );
  }

  if (error || !data) {
    return (
      <CuratorPanel title="Roles">
        <div className="px-4 py-3">
          <CuratorErrorText>
            Failed to load roles: {error instanceof Error ? error.message : 'Unknown error'}
          </CuratorErrorText>
        </div>
      </CuratorPanel>
    );
  }

  return (
    <CuratorPanel title="Roles">
      <CuratorKvList>
        <CuratorKvRow label="Owner" description="Assigns and manages vault roles">
          <AddressOrDash address={data.owner} />
        </CuratorKvRow>
        <CuratorKvRow label="Curator" description="Configures vault parameters and risk">
          <AddressOrDash address={data.curator} />
        </CuratorKvRow>
        <CuratorKvRow label="Allocators" description="Authorized to rebalance allocations">
          <AddressList addresses={data.allocators} />
        </CuratorKvRow>
        <CuratorKvRow label="Sentinels" description="Can deallocate and decrease caps">
          <AddressList addresses={data.sentinels} />
        </CuratorKvRow>
      </CuratorKvList>
    </CuratorPanel>
  );
}
