'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Pencil, X } from 'lucide-react';
import { useVaultV2Governance } from '@/lib/hooks/useVaultV2Governance';
import { useVaultWrite } from '@/lib/hooks/useVaultWrite';
import { TransactionButton } from '@/components/TransactionButton';
import { v2WriteConfigs } from '@/lib/onchain/vault-writes';
import type { VaultV2GovernanceResponse } from '@/app/api/vaults/v2/[id]/governance/route';
import type { Address, Hex } from 'viem';

interface VaultV2TimelocksProps {
  vaultAddress: string;
  preloadedData?: VaultV2GovernanceResponse | null;
}

function formatDuration(seconds: number): string {
  if (seconds === 0) return 'Instant';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function VaultV2Timelocks({ vaultAddress, preloadedData }: VaultV2TimelocksProps) {
  const { data: fetchedData, isLoading, error } = useVaultV2Governance(vaultAddress);
  const data = preloadedData ?? fetchedData;

  const [showForm, setShowForm] = useState(false);

  if (!preloadedData && isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Timelocks</CardTitle>
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
          <CardTitle>Timelocks</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-red-600 dark:text-red-400">
            Failed to load timelocks: {error instanceof Error ? error.message : 'Unknown error'}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Timelocks</CardTitle>
          <Button size="sm" variant={showForm ? 'secondary' : 'outline'} onClick={() => setShowForm((v) => !v)}>
            {showForm ? <X className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
            <span className="ml-1">{showForm ? 'Cancel' : 'Submit / Revoke'}</span>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {data.timelocks.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">No timelocks configured.</p>
        ) : (
          <div className="grid grid-cols-1 gap-2">
            {data.timelocks.map((t) => (
              <div
                key={t.selector}
                className="grid grid-cols-1 gap-2 rounded-md border border-slate-200 p-3 text-sm dark:border-slate-800 sm:grid-cols-4 sm:items-center"
              >
                <div>
                  <p className="text-xs uppercase text-slate-500 dark:text-slate-400">Function</p>
                  <p className="font-semibold text-slate-900 dark:text-slate-100">{t.functionName}</p>
                </div>
                <div>
                  <p className="text-xs uppercase text-slate-500 dark:text-slate-400">Selector</p>
                  <p className="break-all font-mono text-xs text-slate-700 dark:text-slate-200">{t.selector}</p>
                </div>
                <div>
                  <p className="text-xs uppercase text-slate-500 dark:text-slate-400">Duration</p>
                  <p className="font-semibold text-slate-900 dark:text-slate-100">
                    {formatDuration(t.durationSeconds)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {t.durationSeconds === 0 ? (
                    <Badge variant="destructive" className="text-xs">
                      No delay
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs">
                      {t.durationSeconds}s total
                    </Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        {showForm && <TimelockForm vaultAddress={vaultAddress} />}
      </CardContent>
    </Card>
  );
}

function TimelockForm({ vaultAddress }: { vaultAddress: string }) {
  const [submitData, setSubmitData] = useState('');
  const [revokeData, setRevokeData] = useState('');
  const submitWrite = useVaultWrite();
  const revokeWrite = useVaultWrite();
  return (
    <div className="mt-3 grid gap-3 rounded-md border border-dashed border-slate-300 bg-slate-50/60 p-3 dark:border-slate-700 dark:bg-slate-800/40 md:grid-cols-2">
      <div className="space-y-2">
        <h4 className="text-sm font-semibold">Submit Timelocked Call</h4>
        <p className="text-[11px] text-slate-500">Encoded calldata for the timelocked action.</p>
        <Input type="text" placeholder="0x…" value={submitData} onChange={(e) => setSubmitData(e.target.value)} />
        <TransactionButton
          label="Submit"
          onClick={() => {
            if (!submitData) return;
            submitWrite.write(v2WriteConfigs.submit(vaultAddress as Address, submitData as Hex));
          }}
          disabled={!submitData}
          isLoading={submitWrite.isLoading}
          isSuccess={submitWrite.isSuccess}
          error={submitWrite.error}
          txHash={submitWrite.txHash}
        />
      </div>
      <div className="space-y-2">
        <h4 className="text-sm font-semibold">Revoke Pending Action</h4>
        <p className="text-[11px] text-slate-500">Encoded calldata of the action to revoke.</p>
        <Input type="text" placeholder="0x…" value={revokeData} onChange={(e) => setRevokeData(e.target.value)} />
        <TransactionButton
          label="Revoke"
          variant="destructive"
          onClick={() => {
            if (!revokeData) return;
            revokeWrite.write(v2WriteConfigs.revoke(vaultAddress as Address, revokeData as Hex));
          }}
          disabled={!revokeData}
          isLoading={revokeWrite.isLoading}
          isSuccess={revokeWrite.isSuccess}
          error={revokeWrite.error}
          txHash={revokeWrite.txHash}
        />
      </div>
    </div>
  );
}
