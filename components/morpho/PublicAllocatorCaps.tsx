'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useAccount } from 'wagmi';
import { getAddress } from 'viem';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { CapLabel } from '@/components/morpho/CapLabel';
import { TxPreviewDialog } from '@/components/morpho/TxPreviewDialog';
import {
  CuratorEmptyText,
  CuratorKvList,
  CuratorKvRow,
  CuratorPanel,
  CuratorTableShell,
} from '@/components/morpho/CuratorChrome';
import type { CapInfo, VaultV2GovernanceResponse } from '@/app/api/vaults/[id]/governance/route';
import type { V2VaultRiskResponse } from '@/app/api/vaults/[id]/risk/route';
import {
  formatAllocationEditInputExact,
  parseHumanTokenInput,
} from '@/lib/format/allocation-display';
import { vaultV2GovernanceQueryKey } from '@/lib/hooks/useVaultV2Governance';
import { useVaultWrite } from '@/lib/hooks/useVaultWrite';
import {
  capDisplayLabel,
  capLltvPill,
  capRowKey,
  formatCapCompactAmount,
  formatCapTokenAmount,
  sortCapsByAllocationDesc,
} from '@/lib/morpho/v2-cap-format';
import { publicAllocatorMarketLookupKey } from '@/lib/morpho/v2-public-allocator-key';
import {
  diffPublicAllocatorEdits,
  type PublicAllocatorChange,
} from '@/lib/morpho/v2-public-allocator-plan';
import {
  resolveVerifiedMarketParams,
  type MarketParamsInput,
} from '@/lib/morpho/v2-id-data';
import { formatForceDeallocatePenaltyWad } from '@/lib/morpho/vault-v2-api';
import type { TxPreview } from '@/lib/morpho/tx-preview';
import {
  encodePublicAllocatorUpdate,
  publicAllocatorWriteConfig,
} from '@/lib/onchain/public-allocator-calldata';
import { ALLOCATION_SAFE_ROLE } from '@/lib/safe/config';
import { queueSafeTransaction } from '@/lib/safe/queue-vault-write';
import { useCuratorSafeApps } from '@/lib/safe/safe-apps-context';
import {
  canConfirmVaultWriteDestination,
  coerceVaultWriteDestination,
  defaultAllocationDestination,
  eligibleSafeRolesForAddresses,
  walletCanSignAllocation,
  type VaultWriteDestination,
} from '@/lib/safe/vault-write-destination';
import { getConnectorProvider } from '@/lib/wallet/connector-provider';
import { getScanUrlForChain } from '@/lib/constants';
import { isBroadcastTxHash, isWalletRejection } from '@/lib/utils/wallet-error';

type PublicAllocatorState = NonNullable<VaultV2GovernanceResponse['publicAllocator']>;

function AllowedBadge({ allowed }: { allowed: boolean | null }) {
  if (allowed == null) {
    return <span className="text-sm text-muted-foreground">—</span>;
  }
  if (allowed) {
    return (
      <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">Allowed</span>
    );
  }
  return <span className="text-sm text-muted-foreground">Not allowed</span>;
}

function permissionText(allowed: boolean): string {
  return allowed ? 'Allowed' : 'Not allowed';
}

function capSeed(
  raw: string | null,
  symbol: string | null | undefined,
  decimals: number | null | undefined
): string {
  if (raw == null) return '';
  if (formatCapCompactAmount(raw, symbol, decimals) === 'Infinite') return 'Infinite';
  try {
    return formatAllocationEditInputExact(BigInt(raw), symbol, decimals ?? 18);
  } catch {
    return '';
  }
}

function noVaultCap(cap: CapInfo): boolean {
  try {
    return BigInt(cap.absoluteCap ?? '0') === 0n;
  } catch {
    return false;
  }
}

export function PublicAllocatorCaps({
  vaultAddress,
  chainId,
  allocators,
  state,
  caps,
  risk,
  adapterLabels,
  assetSymbol,
  assetDecimals,
}: {
  vaultAddress: string;
  chainId: number;
  allocators: string[];
  state: PublicAllocatorState;
  caps: CapInfo[];
  risk: V2VaultRiskResponse | null | undefined;
  adapterLabels: Map<string, string>;
  assetSymbol?: string | null;
  assetDecimals?: number | null;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { address: walletAddress, isConnected, connector } = useAccount();
  const { connected: safeAppConnected, sdk: safeAppSdk, safeRole: safeAppRole } =
    useCuratorSafeApps();
  const write = useVaultWrite({ chainId });
  const settledWrite = useRef(false);

  const rows = useMemo(() => sortCapsByAllocationDesc(caps), [caps]);
  const paByMarket = useMemo(() => {
    const map = new Map<string, PublicAllocatorState['markets'][number]>();
    for (const row of state.markets) {
      if (row.marketKey && row.adapterAddress) {
        map.set(publicAllocatorMarketLookupKey(row.adapterAddress, row.marketKey), row);
      }
    }
    return map;
  }, [state.markets]);
  const verifiedMarkets = useMemo(() => {
    const map = new Map<string, MarketParamsInput>();
    for (const cap of rows) {
      if (!cap.adapterAddress || !cap.marketKey) continue;
      const market = resolveVerifiedMarketParams(cap, risk);
      if (!market) continue;
      map.set(publicAllocatorMarketLookupKey(cap.adapterAddress, cap.marketKey), market);
    }
    return map;
  }, [rows, risk]);

  const [editing, setEditing] = useState(false);
  const [idleDraft, setIdleDraft] = useState(state.canPullFromIdle === true);
  const [capDrafts, setCapDrafts] = useState<Record<string, string>>({});
  const [pullDrafts, setPullDrafts] = useState<Record<string, boolean>>({});
  const [formError, setFormError] = useState<string | null>(null);
  /** Shown inside the open preview; `useVaultWrite` clears its own error before rethrowing. */
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [preview, setPreview] = useState<TxPreview | null>(null);
  const [pendingChanges, setPendingChanges] = useState<PublicAllocatorChange[]>([]);
  const [queueing, setQueueing] = useState(false);
  const [destination, setDestination] = useState<VaultWriteDestination>(() =>
    defaultAllocationDestination(allocators, undefined)
  );

  const eligibleSafes = useMemo(
    () => eligibleSafeRolesForAddresses(allocators),
    [allocators]
  );
  const walletCanAllocate = walletCanSignAllocation(walletAddress, allocators);
  const walletReady = isConnected && walletCanAllocate;
  const resolvedDestination = useMemo(
    () =>
      coerceVaultWriteDestination(destination, {
        eligibleSafeRoles: eligibleSafes,
        preferredSafeRole: ALLOCATION_SAFE_ROLE,
      }),
    [destination, eligibleSafes]
  );
  const canConfirm = canConfirmVaultWriteDestination(resolvedDestination, {
    walletReady,
    eligibleSafeRoles: eligibleSafes,
  });
  const walletHint = !isConnected
    ? 'Connect an allocator wallet in the top bar, or queue this to the Allocator Safe.'
    : !walletCanAllocate
      ? 'This wallet is not an allocator of the vault. Queue the change to the Allocator Safe.'
      : 'You are an allocator of this vault. These caps apply immediately.';

  const safeApp = useMemo(
    () =>
      safeAppConnected &&
      safeAppSdk &&
      resolvedDestination.kind === 'safe' &&
      safeAppRole === resolvedDestination.role
        ? safeAppSdk
        : null,
    [safeAppConnected, safeAppSdk, safeAppRole, resolvedDestination]
  );

  const writeSucceeded = write.isSuccess;
  const resetWrite = write.reset;

  useEffect(() => {
    if (!writeSucceeded) {
      settledWrite.current = false;
      return;
    }
    if (settledWrite.current) return;
    settledWrite.current = true;
    void queryClient.refetchQueries({ queryKey: vaultV2GovernanceQueryKey(vaultAddress) });
    setPreviewOpen(false);
    setPreview(null);
    setPendingChanges([]);
    setEditing(false);
    resetWrite();
  }, [queryClient, resetWrite, vaultAddress, writeSucceeded]);

  function startEdit() {
    const capsNext: Record<string, string> = {};
    const pullsNext: Record<string, boolean> = {};
    for (const cap of rows) {
      const key =
        cap.adapterAddress && cap.marketKey
          ? publicAllocatorMarketLookupKey(cap.adapterAddress, cap.marketKey)
          : capRowKey(cap, 0);
      const pa = paByMarket.get(key);
      capsNext[key] = capSeed(pa?.absoluteCap ?? null, assetSymbol, assetDecimals);
      pullsNext[key] = pa?.canPullFromMarket === true;
    }
    setCapDrafts(capsNext);
    setPullDrafts(pullsNext);
    setIdleDraft(state.canPullFromIdle === true);
    setFormError(null);
    setDestination(
      coerceVaultWriteDestination(defaultAllocationDestination(allocators, walletAddress), {
        eligibleSafeRoles: eligibleSafes,
        preferredSafeRole: ALLOCATION_SAFE_ROLE,
      })
    );
    setEditing(true);
  }

  function review() {
    const markets = [];
    for (const cap of rows) {
      if (!cap.adapterAddress || !cap.marketKey) continue;
      const key = publicAllocatorMarketLookupKey(cap.adapterAddress, cap.marketKey);
      const market = verifiedMarkets.get(key);
      const pa = paByMarket.get(key);
      if (!market) continue;
      const label = capDisplayLabel(cap, risk, adapterLabels);
      let currentAbsoluteCap: bigint | null = null;
      let nextAbsoluteCap = 0n;
      if (pa?.absoluteCap != null) {
        try {
          currentAbsoluteCap = BigInt(pa.absoluteCap);
        } catch {
          currentAbsoluteCap = null;
        }
        const typed = (capDrafts[key] ?? '').trim();
        if (!typed) {
          setFormError(`Enter a Public Allocator cap for ${label}. Use 0 to turn public allocation off.`);
          return;
        }
        if (currentAbsoluteCap != null && typed === 'Infinite') {
          nextAbsoluteCap = currentAbsoluteCap;
        } else {
          try {
            nextAbsoluteCap = parseHumanTokenInput(typed, assetSymbol, assetDecimals ?? 18);
          } catch {
            setFormError(`Invalid cap for ${label}.`);
            return;
          }
        }
      }
      markets.push({
        label,
        adapterAddress: cap.adapterAddress,
        market,
        currentAbsoluteCap,
        nextAbsoluteCap,
        currentCanPull: pa?.canPullFromMarket ?? null,
        nextCanPull: pullDrafts[key] === true,
      });
    }

    const changes = diffPublicAllocatorEdits({
      currentIdle: state.canPullFromIdle,
      nextIdle: idleDraft,
      markets,
    });
    if (changes.length === 0) {
      setFormError('No Public Allocator settings changed.');
      return;
    }

    const txPreview: TxPreview = {
      title: 'Public Allocator caps',
      description:
        'An allocator of this vault sends these to the Public Allocator. They apply immediately. Vault caps still limit every move.',
      changes: changes.map((change) => {
        if (change.kind === 'idle') {
          return {
            action: 'config' as const,
            label: 'Allow allocations from idle',
            before: permissionText(state.canPullFromIdle === true),
            after: permissionText(change.next),
          };
        }
        if (change.kind === 'pull') {
          return {
            action: 'config' as const,
            label: change.label,
            subtitle: 'Allow deallocation',
            before: permissionText(change.before),
            after: permissionText(change.next),
          };
        }
        return {
          action: 'config' as const,
          label: change.label,
          subtitle: 'Public Allocator cap',
          before: formatCapTokenAmount(change.before.toString(), assetSymbol, assetDecimals),
          after: formatCapTokenAmount(change.next.toString(), assetSymbol, assetDecimals),
        };
      }),
    };

    setFormError(null);
    setSubmitError(null);
    setPendingChanges(changes);
    setPreview(txPreview);
    setPreviewOpen(true);
  }

  async function confirm() {
    if (pendingChanges.length === 0) return;
    const coerced = resolvedDestination;
    if (!canConfirm) {
      setSubmitError(walletHint);
      return;
    }
    setSubmitError(null);

    if (coerced.kind === 'safe') {
      setQueueing(true);
      try {
        const calldata = encodePublicAllocatorUpdate(
          getAddress(state.address),
          getAddress(vaultAddress),
          pendingChanges
        );
        await queueSafeTransaction({
          safeRole: coerced.role,
          calldata,
          description: `Public Allocator caps — ${assetSymbol ?? vaultAddress}`,
          preview: preview ?? {
            title: 'Public Allocator caps',
            changes: [],
          },
          source: {
            type: 'public_allocator',
            vaultAddress: getAddress(vaultAddress),
            vaultSymbol: assetSymbol ?? undefined,
          },
          proposer: walletAddress ? getAddress(walletAddress) : undefined,
          provider: await getConnectorProvider(connector),
          safeAppSdk: safeApp,
        });
        setPreviewOpen(false);
        setEditing(false);
        router.push(`/safe/${coerced.role}/transactions`);
      } catch (error) {
        if (!isWalletRejection(error)) {
          setSubmitError(error instanceof Error ? error.message : 'Failed to queue Safe transaction.');
        }
      } finally {
        setQueueing(false);
      }
      return;
    }

    try {
      write.reset();
      const config = publicAllocatorWriteConfig(
        getAddress(state.address),
        getAddress(vaultAddress),
        pendingChanges
      );
      await write.write(config);
    } catch (error) {
      if (!isWalletRejection(error)) {
        setSubmitError(error instanceof Error ? error.message : 'Failed to submit transaction.');
      }
    }
  }

  return (
    <div className="space-y-6">
      <CuratorPanel
        title="Public Allocator caps"
        description="An allocator sets these. They apply immediately and are not timelocked."
        actions={
          editing ? (
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setEditing(false);
                  setFormError(null);
                }}
              >
                Cancel
              </Button>
              <Button type="button" size="sm" onClick={review}>
                Review
              </Button>
            </div>
          ) : (
            <Button type="button" size="sm" onClick={startEdit}>
              Edit
            </Button>
          )
        }
      >
        <CuratorKvList>
          <CuratorKvRow label="Allow allocations from idle">
            {editing && state.canPullFromIdle != null ? (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={idleDraft}
                  onChange={(event) => setIdleDraft(event.target.checked)}
                />
                {permissionText(idleDraft)}
              </label>
            ) : (
              <AllowedBadge allowed={state.canPullFromIdle} />
            )}
          </CuratorKvRow>
          {state.penalty != null ? (
            <CuratorKvRow label="Penalty">
              <span className="text-muted-foreground">
                {formatForceDeallocatePenaltyWad(state.penalty)}
              </span>
            </CuratorKvRow>
          ) : null}
        </CuratorKvList>
      </CuratorPanel>

      {formError ? <p className="text-sm text-red-600 dark:text-red-400">{formError}</p> : null}

      {rows.length === 0 ? (
        <CuratorEmptyText>
          No market caps to show. Public Allocator target ceilings are per Morpho market.
        </CuratorEmptyText>
      ) : (
        <CuratorTableShell>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Market</TableHead>
                <TableHead>Allocation</TableHead>
                <TableHead>Vault absolute cap</TableHead>
                <TableHead>
                  Public Allocator cap
                  {assetSymbol ? ` (${assetSymbol})` : ''}
                </TableHead>
                <TableHead>Allow deallocation</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((cap, idx) => {
                const key =
                  cap.adapterAddress && cap.marketKey
                    ? publicAllocatorMarketLookupKey(cap.adapterAddress, cap.marketKey)
                    : capRowKey(cap, idx);
                const pa = paByMarket.get(key);
                const market = verifiedMarkets.get(key);
                const lltv = capLltvPill(cap, risk);
                const canEditCap = editing && market != null && pa?.absoluteCap != null;
                const canEditPull = editing && market != null && pa?.canPullFromMarket != null;
                return (
                  <TableRow key={capRowKey(cap, idx)}>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">
                          <CapLabel
                            cap={cap}
                            label={capDisplayLabel(cap, risk, adapterLabels)}
                            chainId={chainId}
                          />
                        </span>
                        {lltv ? (
                          <Badge variant="outline" className="text-[10px] font-normal">
                            {lltv}
                          </Badge>
                        ) : null}
                        {noVaultCap(cap) ? (
                          <Badge variant="outline" className="text-[10px] font-normal">
                            No vault cap
                          </Badge>
                        ) : null}
                      </div>
                      {editing && !market ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Market params unavailable, so this row stays read-only.
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {formatCapCompactAmount(cap.allocation, assetSymbol, assetDecimals)}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {formatCapCompactAmount(cap.absoluteCap, assetSymbol, assetDecimals)}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {canEditCap ? (
                        <Input
                          value={capDrafts[key] ?? ''}
                          onChange={(event) =>
                            setCapDrafts((prev) => ({ ...prev, [key]: event.target.value }))
                          }
                          className="h-8 w-36 text-sm"
                          inputMode="decimal"
                        />
                      ) : (
                        formatCapCompactAmount(pa?.absoluteCap, assetSymbol, assetDecimals)
                      )}
                    </TableCell>
                    <TableCell>
                      {canEditPull ? (
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={pullDrafts[key] === true}
                            onChange={(event) =>
                              setPullDrafts((prev) => ({ ...prev, [key]: event.target.checked }))
                            }
                          />
                          {permissionText(pullDrafts[key] === true)}
                        </label>
                      ) : (
                        <AllowedBadge allowed={pa?.canPullFromMarket ?? null} />
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CuratorTableShell>
      )}

      <TxPreviewDialog
        open={previewOpen}
        preview={preview}
        onOpenChange={(open) => {
          if (!open && (write.isLoading || queueing)) return;
          setPreviewOpen(open);
          if (!open) {
            setSubmitError(null);
            setPreview(null);
            setPendingChanges([]);
          }
        }}
        onConfirm={confirm}
        isLoading={write.isLoading || queueing}
        error={submitError ? new Error(submitError) : write.error}
        isSuccess={write.isSuccess}
        txHash={write.txHash}
        txExplorerHref={
          isBroadcastTxHash(write.txHash)
            ? `${getScanUrlForChain(chainId)}/tx/${write.txHash}`
            : null
        }
        destinationOptions={{
          destination: resolvedDestination,
          onDestinationChange: setDestination,
          walletReady,
          walletHint,
          safeRoles: eligibleSafes,
          confirmEnabled: canConfirm,
        }}
      />
    </div>
  );
}
