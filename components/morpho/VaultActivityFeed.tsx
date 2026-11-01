'use client';

import { useEffect, useMemo, useState } from 'react';
import { keccak256 } from 'viem';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { CollapsibleCard } from '@/components/ui/collapsible-card';
import { PaginationBar } from '@/components/ui/pagination-bar';
import { AddressBadge } from '@/components/AddressBadge';
import { CuratorEmptyText, CuratorErrorText } from '@/components/morpho/CuratorChrome';
import { useVaultActivity } from '@/lib/hooks/useVaultActivity';
import { ExplorerTxLink } from '@/components/morpho/ExplorerAddressLink';
import { getVaultV2PublicAllocatorAddress } from '@/lib/constants/bots';
import { formatRawTokenAmount } from '@/lib/format/number';
import { getTokenDisplayDecimals, resolveAssetDecimals } from '@/lib/format/asset-decimals';
import { buildAdapterLabelMap, capDisplayLabel } from '@/lib/morpho/v2-cap-format';
import { resolveCapIdData } from '@/lib/morpho/v2-id-data';
import {
  activityRoles,
  pendingStatus,
  type VaultActivityRole,
  type VaultActivityRow,
  type VaultActivityType,
} from '@/lib/morpho/vault-activity';
import type { VaultV2GovernanceResponse } from '@/app/api/vaults/[id]/governance/route';
import type { V2VaultRiskResponse } from '@/app/api/vaults/[id]/risk/route';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 10;
const TYPE_FILTERS: ReadonlyArray<{ key: 'all' | VaultActivityType; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'allocation', label: 'Allocation' },
  { key: 'governance', label: 'Governance' },
];
const ROLE_FILTERS: ReadonlyArray<'all' | VaultActivityRole> = [
  'all',
  'Owner',
  'Curator',
  'Allocator',
  'Sentinel',
  'Public Allocator',
];

/** Allocation id (keccak of cap idData) → human target, from the vault's caps. */
function useTargetLabels(
  governance: VaultV2GovernanceResponse | null | undefined,
  risk: V2VaultRiskResponse | null | undefined
): Map<string, string> {
  return useMemo(() => {
    const map = new Map<string, string>();
    if (!governance) return map;
    const adapterLabels = buildAdapterLabelMap(governance.adapters ?? []);
    for (const cap of governance.caps ?? []) {
      const idData = resolveCapIdData(cap, risk);
      if (!idData) continue;
      map.set(keccak256(idData).toLowerCase(), capDisplayLabel(cap, risk, adapterLabels));
    }
    return map;
  }, [governance, risk]);
}

function targetLabel(row: VaultActivityRow, labels: Map<string, string>): string | null {
  // ids = [adapter id, collateral id, market id] for Blue adapters: prefer the most specific.
  for (const id of [...row.ids].reverse()) {
    const label = labels.get(id.toLowerCase());
    if (label) return label;
  }
  return null;
}

export function VaultActivityFeed({
  vaultAddress,
  chainId,
  governance,
  risk,
  assetSymbol,
  assetDecimals,
}: {
  vaultAddress: string;
  chainId: number;
  governance: VaultV2GovernanceResponse | null | undefined;
  risk: V2VaultRiskResponse | null | undefined;
  assetSymbol: string;
  assetDecimals: number | null | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<'all' | VaultActivityType>('all');
  const [role, setRole] = useState<'all' | VaultActivityRole>('all');
  const [page, setPage] = useState(0);
  // Timelock badges flip from Timelocked to Executable while the card is open.
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000);
    return () => clearInterval(id);
  }, [open]);
  const { data, isLoading, error } = useVaultActivity(vaultAddress, { enabled: open });
  const labels = useTargetLabels(governance, risk);
  const chainDecimals = resolveAssetDecimals(assetSymbol, assetDecimals ?? undefined);
  const displayDecimals = getTokenDisplayDecimals(assetSymbol, chainDecimals);

  const roleInput = useMemo(
    () => ({
      owner: governance?.owner,
      curator: governance?.curator,
      allocators: governance?.allocators ?? [],
      sentinels: governance?.sentinels ?? [],
      publicAllocator: getVaultV2PublicAllocatorAddress(chainId),
    }),
    [governance, chainId]
  );

  const rows = useMemo(() => {
    return (data?.rows ?? [])
      .map((r) => ({ row: r, roles: activityRoles(r.actor, roleInput) }))
      .filter(({ row }) => type === 'all' || row.type === type)
      .filter(({ roles }) => role === 'all' || roles.includes(role));
  }, [data?.rows, roleInput, type, role]);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = rows.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  const filterButtons = (
    <div className="flex flex-wrap items-center gap-1" onClick={(e) => e.stopPropagation()}>
      {TYPE_FILTERS.map((f) => (
        <Button
          key={f.key}
          size="sm"
          variant={type === f.key ? 'secondary' : 'ghost'}
          className="h-7"
          onClick={() => {
            setType(f.key);
            setPage(0);
          }}
        >
          {f.label}
        </Button>
      ))}
      <select
        aria-label="Filter by role"
        className="h-7 rounded-md border border-border bg-background px-2 text-xs"
        value={role}
        onChange={(e) => {
          setRole(e.target.value as 'all' | VaultActivityRole);
          setPage(0);
        }}
      >
        {ROLE_FILTERS.map((r) => (
          <option key={r} value={r}>
            {r === 'all' ? 'All roles' : r}
          </option>
        ))}
      </select>
    </div>
  );

  const th = 'whitespace-nowrap px-3 py-2 text-left text-xs font-medium text-muted-foreground';
  const td = 'whitespace-nowrap border-t border-border/60 px-3 py-2 align-middle';

  return (
    <CollapsibleCard
      title="Activity"
      headerRight={open ? filterButtons : undefined}
      onOpenChange={setOpen}
    >
      {!open ? null : isLoading ? (
        <div className="space-y-2 p-4">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : error ? (
        <div className="p-4">
          <CuratorErrorText>
            {error instanceof Error ? error.message : 'Failed to load activity'}
          </CuratorErrorText>
        </div>
      ) : (
        <div className="space-y-2 p-4">
          {data?.governanceHistory === 'complete' && data.governanceHistorySince != null && (
            <p className="text-xs text-muted-foreground">
              Governance history covers the role Safes&apos; latest transactions — calls before{' '}
              {new Date(data.governanceHistorySince * 1000).toLocaleDateString()} may be missing.
            </p>
          )}
          {data?.governanceHistory !== 'complete' && (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              {data?.governanceHistory === 'unavailable'
                ? 'Executed governance calls need NEXT_PUBLIC_SAFE_API_KEY (they come from the role Safes’ history). Showing allocations and pending submissions only.'
                : 'Some role Safe histories failed to load; governance rows may be incomplete.'}
            </p>
          )}
          {rows.length === 0 ? (
            <CuratorEmptyText>No activity for this filter.</CuratorEmptyText>
          ) : (
            <>
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className={th}>Time (local)</th>
                      <th className={th}>Type</th>
                      <th className={th}>Action</th>
                      <th className={th}>Actor</th>
                      <th className={`${th} text-right`}>Amount</th>
                      <th className={th}>Target</th>
                      <th className={th}>Tx</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map(({ row, roles }) => {
                      const target = targetLabel(row, labels);
                      const amount = row.amount != null ? BigInt(row.amount) : null;
                      return (
                        <tr key={row.id}>
                          <td className={cn(td, 'tabular-nums text-xs')}>
                            {row.pending && !row.actor
                              ? 'Pending'
                              : row.timestamp > 0
                              ? new Date(row.timestamp * 1000).toLocaleString(undefined, {
                                  dateStyle: 'short',
                                  timeStyle: 'short',
                                })
                              : '—'}
                          </td>
                          <td className={td}>
                            <Badge variant={row.type === 'governance' ? 'outline' : 'secondary'} className="text-[10px]">
                              {row.type === 'governance' ? 'Governance' : 'Allocation'}
                            </Badge>
                          </td>
                          <td className={cn(td, 'font-mono text-xs')}>
                            {row.action}
                            {row.pending && <PendingBadge validAt={row.pending.validAt} now={now} />}
                          </td>
                          <td className={td}>
                            {row.actor ? (
                              <div className="flex flex-col">
                                <AddressBadge address={row.actor} truncate label="auto" />
                                {roles.length > 0 && (
                                  <span className="text-[10px] text-muted-foreground">{roles.join(' · ')}</span>
                                )}
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </td>
                          <td
                            className={cn(
                              td,
                              'text-right tabular-nums',
                              amount != null && amount < 0n && 'text-red-600 dark:text-red-400',
                              amount != null && amount > 0n && 'text-emerald-600 dark:text-emerald-400'
                            )}
                          >
                            {amount != null
                              ? formatSignedAmount(amount, chainDecimals, displayDecimals, assetSymbol)
                              : '—'}
                          </td>
                          <td className={cn(td, 'text-xs')}>
                            {row.type === 'allocation'
                              ? `${amount != null && amount < 0n ? `${target ?? 'Adapter'} → Idle` : `Idle → ${target ?? 'Adapter'}`}`
                              : '—'}
                          </td>
                          <td className={td}>
                            {row.txHash ? <ExplorerTxLink hash={row.txHash} chainId={chainId} /> : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <PaginationBar
                page={safePage}
                totalPages={totalPages}
                total={rows.length}
                pageSize={PAGE_SIZE}
                onPage={setPage}
              />
            </>
          )}
        </div>
      )}
    </CollapsibleCard>
  );
}

/** `+576.939 USDC`, `−14.701 USDC`; dust below display precision reads `< 0.001`. */
function formatSignedAmount(
  amount: bigint,
  decimals: number,
  displayDecimals: number,
  symbol: string
): string {
  const sign = amount > 0n ? '+' : amount < 0n ? '−' : '';
  const abs = amount < 0n ? -amount : amount;
  const unit = 10n ** BigInt(Math.max(0, decimals - displayDecimals));
  if (abs > 0n && abs < unit) {
    return `${sign}< ${(1 / 10 ** displayDecimals).toFixed(displayDecimals)} ${symbol}`;
  }
  return `${sign}${formatRawTokenAmount(abs, decimals, displayDecimals)} ${symbol}`;
}

function PendingBadge({ validAt, now }: { validAt: number; now: number }) {
  const status = pendingStatus(validAt, now);
  return (
    <Badge variant="outline" className="ml-1 text-[10px]">
      {status === 'executable'
        ? 'Executable'
        : status === 'timelocked'
          ? `Timelocked until ${new Date(validAt * 1000).toLocaleDateString()}`
          : 'Pending · unlock time unknown'}
    </Badge>
  );
}
