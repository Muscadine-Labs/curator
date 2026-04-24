'use client';

import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AddressBadge } from '@/components/AddressBadge';
import { TransactionButton } from '@/components/TransactionButton';
import { InlineEdit } from '@/components/morpho/InlineEdit';
import { useVaultRoles } from '@/lib/hooks/useVaultRoles';
import { useVaultWrite } from '@/lib/hooks/useVaultWrite';
import { v1WriteConfigs } from '@/lib/onchain/vault-writes';
import { isAddress, type Address } from 'viem';
import type { VaultRolesData } from '@/lib/hooks/useVaultRoles';

interface VaultRolesV1Props {
  vaultAddress: Address | string;
  preloadedData?: VaultRolesData | null;
}

export function VaultRolesV1({ vaultAddress, preloadedData }: VaultRolesV1Props) {
  const { data: fetchedRoles, isLoading, error } = useVaultRoles(vaultAddress as Address);
  const roles = preloadedData ?? fetchedRoles;

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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Roles</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <OwnerTile vaultAddress={vaultAddress as string} owner={roles.owner} />
          <CuratorTile vaultAddress={vaultAddress as string} curator={roles.curator} />
          <GuardianTile vaultAddress={vaultAddress as string} guardian={roles.guardian} />
          <AllocatorsTile vaultAddress={vaultAddress as string} allocators={roles.allocators} />
        </div>
      </CardContent>
    </Card>
  );
}

function OwnerTile({ vaultAddress, owner }: { vaultAddress: string; owner: string | null }) {
  const [input, setInput] = useState('');
  const write = useVaultWrite();
  const valid = isAddress(input);
  return (
    <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
      <InlineEdit
        label="Transfer ownership"
        form={() => (
          <div className="space-y-2">
            <Input
              type="text"
              placeholder="0x… new owner"
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
            <TransactionButton
              label="Transfer Ownership"
              variant="destructive"
              onClick={() => {
                if (!valid) return;
                write.write(v1WriteConfigs.transferOwnership(vaultAddress as Address, input as Address));
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
  const [input, setInput] = useState('');
  const write = useVaultWrite();
  const valid = isAddress(input);
  return (
    <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
      <InlineEdit
        label="Set curator"
        form={() => (
          <div className="space-y-2">
            <Input
              type="text"
              placeholder="0x… new curator"
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
            <TransactionButton
              label="Set Curator"
              onClick={() => {
                if (!valid) return;
                write.write(v1WriteConfigs.setCurator(vaultAddress as Address, input as Address));
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

function GuardianTile({ vaultAddress, guardian }: { vaultAddress: string; guardian: string | null }) {
  const [input, setInput] = useState('');
  const submit = useVaultWrite();
  const accept = useVaultWrite();
  const valid = isAddress(input);
  return (
    <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
      <InlineEdit
        label="Submit/accept guardian"
        form={() => (
          <div className="space-y-3">
            <div className="space-y-2">
              <label className="text-[11px] text-slate-500">Submit new guardian (timelocked)</label>
              <Input
                type="text"
                placeholder="0x…"
                value={input}
                onChange={(e) => setInput(e.target.value)}
              />
              <TransactionButton
                label="Submit Guardian"
                onClick={() => {
                  if (!valid) return;
                  submit.write(v1WriteConfigs.submitGuardian(vaultAddress as Address, input as Address));
                }}
                disabled={!valid}
                isLoading={submit.isLoading}
                isSuccess={submit.isSuccess}
                error={submit.error}
                txHash={submit.txHash}
              />
            </div>
            <div className="border-t border-slate-200 pt-2 dark:border-slate-700">
              <p className="mb-2 text-[11px] text-slate-500">Accept a pending guardian after timelock.</p>
              <TransactionButton
                label="Accept Guardian"
                onClick={() => accept.write(v1WriteConfigs.acceptGuardian(vaultAddress as Address))}
                isLoading={accept.isLoading}
                isSuccess={accept.isSuccess}
                error={accept.error}
                txHash={accept.txHash}
              />
            </div>
          </div>
        )}
      >
        <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Guardian</p>
        {guardian ? (
          <div className="mt-2">
            <AddressBadge address={guardian} truncate={false} />
          </div>
        ) : (
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Not set</p>
        )}
      </InlineEdit>
    </div>
  );
}

function AllocatorsTile({ vaultAddress, allocators }: { vaultAddress: string; allocators: string[] }) {
  return (
    <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
      <InlineEdit
        label="Add allocator"
        buttonSize="sm"
        buttonLabel="Add"
        form={(close) => <AllocatorForm vaultAddress={vaultAddress} grant onDone={close} />}
      >
        <div className="flex items-center justify-between">
          <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Allocators</p>
          <Badge variant="outline" className="text-xs">
            {allocators.length}
          </Badge>
        </div>
      </InlineEdit>
      {allocators.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">No allocators configured</p>
      ) : (
        <div className="mt-2 space-y-2">
          {allocators.map((addr) => (
            <AllocatorRow key={addr} vaultAddress={vaultAddress} address={addr} />
          ))}
        </div>
      )}
    </div>
  );
}

function AllocatorRow({ vaultAddress, address }: { vaultAddress: string; address: string }) {
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
              write.write(v1WriteConfigs.setIsAllocator(vaultAddress as Address, address as Address, false))
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
        <Button size="icon" variant="ghost" aria-label="Revoke allocator" onClick={() => setConfirm(true)}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}

function AllocatorForm({
  vaultAddress,
  grant,
  onDone,
}: {
  vaultAddress: string;
  grant: boolean;
  onDone: () => void;
}) {
  const [addr, setAddr] = useState('');
  const write = useVaultWrite();
  const valid = isAddress(addr);
  return (
    <div className="space-y-2">
      <Input type="text" placeholder="0x… allocator" value={addr} onChange={(e) => setAddr(e.target.value)} />
      <div className="flex items-center gap-2">
        <TransactionButton
          label={grant ? 'Grant Allocator' : 'Revoke Allocator'}
          onClick={() => {
            if (!valid) return;
            write.write(v1WriteConfigs.setIsAllocator(vaultAddress as Address, addr as Address, grant));
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
