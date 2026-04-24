'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Pencil } from 'lucide-react';
import { useVaultV2Governance } from '@/lib/hooks/useVaultV2Governance';
import { useVaultWrite } from '@/lib/hooks/useVaultWrite';
import { TransactionButton } from '@/components/TransactionButton';
import { v2WriteConfigs } from '@/lib/onchain/vault-writes';
import { formatNumber } from '@/lib/format/number';
import type { CapInfo, VaultV2GovernanceResponse } from '@/app/api/vaults/v2/[id]/governance/route';
import type { Address, Hex } from 'viem';

interface VaultV2CapsProps {
  vaultAddress: string;
  preloadedData?: VaultV2GovernanceResponse | null;
}

function formatRelativeCap(relativeCap: string): string {
  try {
    const scaled = BigInt(relativeCap);
    const percent = Number(scaled) / 1e16;
    return `${percent.toFixed(2)}%`;
  } catch {
    return relativeCap;
  }
}

function formatBigIntValue(value: string): string {
  try {
    return formatNumber(BigInt(value));
  } catch {
    return value;
  }
}

export function VaultV2Caps({ vaultAddress, preloadedData }: VaultV2CapsProps) {
  const { data: fetchedData, isLoading, error } = useVaultV2Governance(vaultAddress);
  const data = preloadedData ?? fetchedData;

  if (!preloadedData && isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Adapter Caps</CardTitle>
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
          <CardTitle>Adapter Caps</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-red-600 dark:text-red-400">
            Failed to load caps: {error instanceof Error ? error.message : 'Unknown error'}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (data.caps.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Adapter Caps</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-500 dark:text-slate-400">No caps configured.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Adapter Caps</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 gap-2">
          {data.caps.map((cap, idx) => (
            <CapRow key={`${cap.adapterAddress ?? cap.marketKey ?? cap.collateralAddress ?? 'idx'}-${idx}`} vaultAddress={vaultAddress} cap={cap} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function CapRow({ vaultAddress, cap }: { vaultAddress: string; cap: CapInfo }) {
  const [open, setOpen] = useState(false);
  const targetLabel = cap.adapterAddress ?? cap.marketKey ?? cap.collateralAddress ?? 'Global Cap';

  return (
    <div className="rounded-md border border-slate-200 p-4 dark:border-slate-800">
      <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-6 sm:items-center">
        <div>
          <p className="text-xs uppercase text-slate-500 dark:text-slate-400">Type</p>
          <div className="mt-1 flex items-center gap-2">
            <Badge variant="outline" className="text-xs">
              {cap.type}
            </Badge>
          </div>
        </div>
        <div className="sm:col-span-2">
          <p className="text-xs uppercase text-slate-500 dark:text-slate-400">Target</p>
          <p className="mt-1 break-all text-xs text-slate-700 dark:text-slate-200">{targetLabel}</p>
        </div>
        <div>
          <p className="text-xs uppercase text-slate-500 dark:text-slate-400">Absolute</p>
          <p className="mt-1 font-semibold text-slate-900 dark:text-slate-100">{formatBigIntValue(cap.absoluteCap)}</p>
        </div>
        <div>
          <p className="text-xs uppercase text-slate-500 dark:text-slate-400">Relative</p>
          <p className="mt-1 font-semibold text-slate-900 dark:text-slate-100">{formatRelativeCap(cap.relativeCap)}</p>
        </div>
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-xs uppercase text-slate-500 dark:text-slate-400">Allocation</p>
            <p className="mt-1 font-semibold text-slate-900 dark:text-slate-100">{formatBigIntValue(cap.allocation)}</p>
          </div>
          <Button
            size="icon"
            variant={open ? 'secondary' : 'ghost'}
            aria-label="Edit cap"
            onClick={() => setOpen((v) => !v)}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      {open && (
        <div className="mt-3 rounded-md border border-dashed border-slate-300 bg-slate-50/60 p-3 dark:border-slate-700 dark:bg-slate-800/40">
          <CapEditForm vaultAddress={vaultAddress} cap={cap} onClose={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}

type CapAction = 'increaseAbsolute' | 'decreaseAbsolute' | 'increaseRelative' | 'decreaseRelative';

function CapEditForm({ vaultAddress, cap }: { vaultAddress: string; cap: CapInfo; onClose: () => void }) {
  const [action, setAction] = useState<CapAction>('increaseAbsolute');
  const [idData, setIdData] = useState('');
  const [value, setValue] = useState('');
  const write = useVaultWrite();

  const isRelative = action === 'increaseRelative' || action === 'decreaseRelative';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {(['increaseAbsolute', 'decreaseAbsolute', 'increaseRelative', 'decreaseRelative'] as CapAction[]).map((a) => (
          <button
            key={a}
            onClick={() => setAction(a)}
            className={`rounded-md px-3 py-1 text-xs font-medium ${
              action === a ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'
            }`}
          >
            {a === 'increaseAbsolute'
              ? '+ Absolute'
              : a === 'decreaseAbsolute'
                ? '− Absolute'
                : a === 'increaseRelative'
                  ? '+ Relative'
                  : '− Relative'}
          </button>
        ))}
      </div>
      <div className="space-y-1">
        <label className="text-[11px] text-slate-500">ID Data (bytes). Pre-fill from marketKey/adapter when applicable.</label>
        <Input
          type="text"
          placeholder={(cap.marketKey as string | undefined) ?? '0x…'}
          value={idData}
          onChange={(e) => setIdData(e.target.value)}
        />
      </div>
      <div className="space-y-1">
        <label className="text-[11px] text-slate-500">
          {isRelative ? 'New Relative Cap (%)' : 'New Absolute Cap (raw uint256)'}
        </label>
        <Input
          type="text"
          placeholder={isRelative ? 'e.g. 50 for 50%' : 'e.g. 1000000000000000000'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </div>
      <TransactionButton
        label={
          action === 'increaseAbsolute'
            ? 'Increase Absolute Cap'
            : action === 'decreaseAbsolute'
              ? 'Decrease Absolute Cap'
              : action === 'increaseRelative'
                ? 'Increase Relative Cap'
                : 'Decrease Relative Cap'
        }
        onClick={() => {
          if (!idData || !value) return;
          const parsed = isRelative ? BigInt(Math.floor(parseFloat(value) * 1e16)) : BigInt(value);
          const configs = {
            increaseAbsolute: v2WriteConfigs.increaseAbsoluteCap,
            decreaseAbsolute: v2WriteConfigs.decreaseAbsoluteCap,
            increaseRelative: v2WriteConfigs.increaseRelativeCap,
            decreaseRelative: v2WriteConfigs.decreaseRelativeCap,
          };
          write.write(configs[action](vaultAddress as Address, idData as Hex, parsed));
        }}
        disabled={!idData || !value}
        isLoading={write.isLoading}
        isSuccess={write.isSuccess}
        error={write.error}
        txHash={write.txHash}
      />
    </div>
  );
}
