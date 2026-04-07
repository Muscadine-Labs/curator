'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
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

  const [showManage, setShowManage] = useState(false);
  const [submitData, setSubmitData] = useState('');
  const [revokeData, setRevokeData] = useState('');
  const submitWrite = useVaultWrite();
  const revokeWrite = useVaultWrite();

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

  if (data.timelocks.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Timelocks</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-500 dark:text-slate-400">No timelocks configured.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Timelocks</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="grid grid-cols-1 gap-2">
          {data.timelocks.map((t) => (
            <div
              key={t.selector}
              className="grid grid-cols-1 gap-2 rounded-md border border-slate-200 p-3 text-sm dark:border-slate-800 sm:grid-cols-4 sm:items-center"
            >
              <div>
                <p className="text-xs uppercase text-slate-500 dark:text-slate-400">Function</p>
                <p className="font-semibold text-slate-900 dark:text-slate-100">
                  {t.functionName}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase text-slate-500 dark:text-slate-400">Selector</p>
                <p className="font-mono text-xs text-slate-700 dark:text-slate-200 break-all">
                  {t.selector}
                </p>
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

        {/* Manage Section */}
        <div className="border-t pt-4">
          <button
            onClick={() => setShowManage(!showManage)}
            className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100"
          >
            {showManage ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            Manage Timelocks
          </button>

          {showManage && (
            <div className="mt-4 space-y-4">
              {/* Submit Timelocked Call */}
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-4 space-y-3">
                <h4 className="text-sm font-semibold">Submit Timelocked Call</h4>
                <p className="text-xs text-muted-foreground">Encoded calldata for the timelocked action</p>
                <Input
                  type="text"
                  placeholder="0x..."
                  value={submitData}
                  onChange={(e) => setSubmitData(e.target.value)}
                />
                <TransactionButton
                  label="Submit"
                  onClick={() => { if (!submitData) return; submitWrite.write(v2WriteConfigs.submit(vaultAddress as Address, submitData as Hex)); }}
                  disabled={!submitData}
                  isLoading={submitWrite.isLoading}
                  isSuccess={submitWrite.isSuccess}
                  error={submitWrite.error}
                  txHash={submitWrite.txHash}
                />
              </div>

              {/* Revoke Timelocked Call */}
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-4 space-y-3">
                <h4 className="text-sm font-semibold">Revoke Pending Action</h4>
                <p className="text-xs text-muted-foreground">Encoded calldata of the action to revoke</p>
                <Input
                  type="text"
                  placeholder="0x..."
                  value={revokeData}
                  onChange={(e) => setRevokeData(e.target.value)}
                />
                <TransactionButton
                  label="Revoke"
                  variant="destructive"
                  onClick={() => { if (!revokeData) return; revokeWrite.write(v2WriteConfigs.revoke(vaultAddress as Address, revokeData as Hex)); }}
                  disabled={!revokeData}
                  isLoading={revokeWrite.isLoading}
                  isSuccess={revokeWrite.isSuccess}
                  error={revokeWrite.error}
                  txHash={revokeWrite.txHash}
                />
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

