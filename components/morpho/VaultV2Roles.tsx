'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { AddressBadge } from '@/components/AddressBadge';
import { TransactionButton } from '@/components/TransactionButton';
import { InlineEdit } from '@/components/morpho/InlineEdit';
import { useVaultV2Governance } from '@/lib/hooks/useVaultV2Governance';
import { useVaultWrite } from '@/lib/hooks/useVaultWrite';
import { v2WriteConfigs } from '@/lib/onchain/vault-writes';
import { isAddress, type Address } from 'viem';
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
        <OwnerTile vaultAddress={vaultAddress} owner={data.owner} />
        <CuratorTile vaultAddress={vaultAddress} curator={data.curator} />
        <AllocatorsTile allocators={data.allocators} />
        <SentinelsTile vaultAddress={vaultAddress} sentinels={data.sentinels} />
      </CardContent>
    </Card>
  );
}

function OwnerTile({ vaultAddress, owner }: { vaultAddress: string; owner: string | null }) {
  const [newOwner, setNewOwner] = useState('');
  const write = useVaultWrite();
  const valid = isAddress(newOwner);

  return (
    <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
      <InlineEdit
        label="Change owner"
        form={() => (
          <div className="space-y-2">
            <Input
              type="text"
              placeholder="0x… new owner"
              value={newOwner}
              onChange={(e) => setNewOwner(e.target.value)}
            />
            <TransactionButton
              label="Set Owner"
              variant="destructive"
              onClick={() => {
                if (!valid) return;
                write.write(v2WriteConfigs.setOwner(vaultAddress as Address, newOwner as Address));
              }}
              disabled={!valid}
              isLoading={write.isLoading}
              isSuccess={write.isSuccess}
              error={write.error}
              txHash={write.txHash}
            />
          </div>
        )}
      >
        <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Owner</p>
        {owner ? (
          <div className="mt-2">
            <AddressBadge address={owner} truncate={false} />
          </div>
        ) : (
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Not set</p>
        )}
      </InlineEdit>
    </div>
  );
}

function CuratorTile({ vaultAddress, curator }: { vaultAddress: string; curator: string | null }) {
  const [newCurator, setNewCurator] = useState('');
  const write = useVaultWrite();
  const valid = isAddress(newCurator);

  return (
    <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
      <InlineEdit
        label="Change curator"
        form={() => (
          <div className="space-y-2">
            <Input
              type="text"
              placeholder="0x… new curator"
              value={newCurator}
              onChange={(e) => setNewCurator(e.target.value)}
            />
            <TransactionButton
              label="Set Curator"
              onClick={() => {
                if (!valid) return;
                write.write(v2WriteConfigs.setCurator(vaultAddress as Address, newCurator as Address));
              }}
              disabled={!valid}
              isLoading={write.isLoading}
              isSuccess={write.isSuccess}
              error={write.error}
              txHash={write.txHash}
            />
          </div>
        )}
      >
        <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Curator</p>
        {curator ? (
          <div className="mt-2">
            <AddressBadge address={curator} truncate={false} />
          </div>
        ) : (
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Not set</p>
        )}
      </InlineEdit>
    </div>
  );
}

function AllocatorsTile({ allocators }: { allocators: string[] }) {
  return (
    <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Allocators</p>
        <Badge variant="outline" className="text-xs">
          {allocators.length}
        </Badge>
      </div>
      {allocators.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">No allocators configured</p>
      ) : (
        <div className="mt-2 space-y-2">
          {allocators.map((addr) => (
            <AddressBadge key={addr} address={addr} truncate={false} />
          ))}
        </div>
      )}
      <p className="mt-3 text-[11px] leading-snug text-slate-500 dark:text-slate-400">
        Allocators on V2 are managed via role registries — manage via the curator registry UI.
      </p>
    </div>
  );
}

function SentinelsTile({ vaultAddress, sentinels }: { vaultAddress: string; sentinels: string[] }) {
  return (
    <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
      <InlineEdit
        label="Add sentinel"
        buttonSize="sm"
        buttonLabel="Add"
        form={(close) => <SentinelForm vaultAddress={vaultAddress} isGrant onDone={close} />}
      >
        <div className="flex items-center justify-between">
          <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Sentinels</p>
          <Badge variant="outline" className="text-xs">
            {sentinels.length}
          </Badge>
        </div>
      </InlineEdit>
      {sentinels.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">No sentinels configured</p>
      ) : (
        <div className="mt-2 space-y-2">
          {sentinels.map((addr) => (
            <SentinelRow key={addr} vaultAddress={vaultAddress} address={addr} />
          ))}
        </div>
      )}
    </div>
  );
}

function SentinelRow({ vaultAddress, address }: { vaultAddress: string; address: string }) {
  const [confirm, setConfirm] = useState(false);
  const write = useVaultWrite();
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-slate-100 bg-slate-50/50 px-2 py-1 dark:border-slate-800 dark:bg-slate-800/40">
      <AddressBadge address={address} truncate={false} />
      {confirm ? (
        <div className="flex items-center gap-1">
          <TransactionButton
            label="Revoke"
            variant="destructive"
            onClick={() =>
              write.write(v2WriteConfigs.setIsSentinel(vaultAddress as Address, address as Address, false))
            }
            isLoading={write.isLoading}
            isSuccess={write.isSuccess}
            error={write.error}
            txHash={write.txHash}
          />
          <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button
          size="icon"
          variant="ghost"
          aria-label="Revoke sentinel"
          onClick={() => setConfirm(true)}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}

function SentinelForm({
  vaultAddress,
  isGrant,
  onDone,
}: {
  vaultAddress: string;
  isGrant: boolean;
  onDone: () => void;
}) {
  const [addr, setAddr] = useState('');
  const write = useVaultWrite();
  const valid = isAddress(addr);
  return (
    <div className="space-y-2">
      <Input
        type="text"
        placeholder="0x… sentinel address"
        value={addr}
        onChange={(e) => setAddr(e.target.value)}
      />
      <div className="flex items-center gap-2">
        <TransactionButton
          label={isGrant ? 'Grant Sentinel' : 'Revoke Sentinel'}
          onClick={() => {
            if (!valid) return;
            write.write(v2WriteConfigs.setIsSentinel(vaultAddress as Address, addr as Address, isGrant));
          }}
          disabled={!valid}
          isLoading={write.isLoading}
          isSuccess={write.isSuccess}
          error={write.error}
          txHash={write.txHash}
        />
        {write.isSuccess && (
          <Button size="sm" variant="outline" onClick={onDone}>
            Done
          </Button>
        )}
      </div>
    </div>
  );
}

// Keep icon available without warning about unused
void Plus;
