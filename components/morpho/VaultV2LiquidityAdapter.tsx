'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAccount } from 'wagmi';
import { useQueryClient } from '@tanstack/react-query';
import type { Address } from 'viem';
import { getAddress } from 'viem';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AllocationPill } from '@/components/morpho/AllocationListView';
import {
  CuratorKvList,
  CuratorKvRow,
  CuratorPanel,
} from '@/components/morpho/CuratorChrome';
import { TxPreviewDialog } from '@/components/morpho/TxPreviewDialog';
import { TxErrorBanner } from '@/components/TxErrorBanner';
import { useVaultWrite } from '@/lib/hooks/useVaultWrite';
import { isBroadcastTxHash } from '@/lib/utils/wallet-error';
import { v2WriteConfigs } from '@/lib/onchain/vault-writes';
import { formatAllocationTableAmount } from '@/lib/format/allocation-display';
import { resolveAssetDecimals } from '@/lib/format/asset-decimals';
import { buildLiquidityAdapterPreview } from '@/lib/morpho/tx-preview';
import type { TxPreview } from '@/lib/morpho/tx-preview';
import {
  buildLiquidityAdapterOptions,
  buildVaultOrIdleLiquidityOptions,
  resolveLiquidityDisplay,
  type LiquidityAdapterOption,
} from '@/lib/morpho/vault-v2-liquidity';
import { curatorWriteToCalldata } from '@/lib/morpho/vault-v2-curator-write';
import type { VaultV2GovernanceResponse } from '@/app/api/vaults/[id]/governance/route';
import type { V2VaultRiskResponse } from '@/app/api/vaults/[id]/risk/route';
import { vaultV2GovernanceQueryKey } from '@/lib/hooks/useVaultV2Governance';
import { queueSafeTransaction } from '@/lib/safe/queue-vault-write';
import { getConnectorProvider } from '@/lib/wallet/connector-provider';
import { useCuratorSafeApps } from '@/lib/safe/safe-apps-context';
import { ALLOCATION_SAFE_ROLE, type SafeRole } from '@/lib/safe/config';
import {
  canConfirmVaultWriteDestination,
  coerceVaultWriteDestination,
  defaultAllocationDestination,
  eligibleSafeRolesForAddresses,
  walletCanSignAllocation,
  type VaultWriteDestination,
} from '@/lib/safe/vault-write-destination';

interface VaultV2LiquidityAdapterProps {
  vaultAddress: string;
  chainId: number;
  governance: VaultV2GovernanceResponse | null | undefined;
  risk: V2VaultRiskResponse;
  assetSymbol?: string | null;
  assetDecimals?: number | null;
  /** Fee wrappers pick a Morpho vault adapter or idle. Strategy vaults pick a market. */
  variant?: 'market' | 'vault-or-idle';
}

function LiquidityMarketLabel({
  option,
}: {
  option: Pick<LiquidityAdapterOption, 'label' | 'lltv' | 'morphoHref'>;
}) {
  const inner = (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="font-medium text-foreground">{option.label}</span>
      {option.lltv ? <AllocationPill>{option.lltv}</AllocationPill> : null}
    </span>
  );

  if (!option.morphoHref) return inner;

  return (
    <a
      href={option.morphoHref}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex flex-wrap items-center gap-2 hover:opacity-80"
      onClick={(e) => e.stopPropagation()}
    >
      {inner}
    </a>
  );
}

export function VaultV2LiquidityAdapter({
  vaultAddress,
  chainId,
  governance,
  risk,
  assetSymbol,
  assetDecimals,
  variant = 'market',
}: VaultV2LiquidityAdapterProps) {
  const [changing, setChanging] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [txPreview, setTxPreview] = useState<TxPreview | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [queueSafeError, setQueueSafeError] = useState<string | null>(null);
  const [queueingSafe, setQueueingSafe] = useState(false);
  const [writeDestination, setWriteDestination] = useState<VaultWriteDestination>(() =>
    defaultAllocationDestination(governance?.allocators, undefined)
  );

  const write = useVaultWrite({ chainId });
  const queryClient = useQueryClient();
  const router = useRouter();
  const { address: walletAddress, isConnected, connector } = useAccount();
  const { connected: safeAppConnected, sdk: safeAppSdk, safeRole: safeAppRole } =
    useCuratorSafeApps();

  useEffect(() => {
    if (!write.isSuccess) return;
    setPreviewOpen(false);
    setChanging(false);
    void Promise.all([
      queryClient.refetchQueries({ queryKey: vaultV2GovernanceQueryKey(vaultAddress) }),
      queryClient.refetchQueries({ queryKey: ['vault-v2-risk', vaultAddress] }),
    ]);
  }, [write.isSuccess, queryClient, vaultAddress]);

  const allocators = useMemo(
    () => governance?.allocators ?? [],
    [governance?.allocators]
  );
  const walletCanAllocate = walletCanSignAllocation(walletAddress, allocators);
  const walletReady = isConnected && walletCanAllocate;
  const allocatorWalletHint = !isConnected
    ? 'Connect your wallet in the top bar to sign directly with your EOA.'
    : !walletCanAllocate
      ? 'Connected wallet is not an on-chain allocator — switch to an allocator EOA or queue in the Allocator Safe.'
      : undefined;
  const eligibleAllocatorSafes = useMemo(
    () => eligibleSafeRolesForAddresses(allocators),
    [allocators]
  );

  const allocatorSafeAppSdk = useMemo(
    () =>
      safeAppConnected &&
      safeAppSdk &&
      writeDestination.kind === 'safe' &&
      safeAppRole === writeDestination.role
        ? safeAppSdk
        : null,
    [safeAppConnected, safeAppSdk, safeAppRole, writeDestination]
  );

  const dec = resolveAssetDecimals(assetSymbol, assetDecimals ?? risk.vaultAsset?.decimals);

  const display = resolveLiquidityDisplay(governance);
  const options = useMemo(() => {
    if (!governance) return [];
    return variant === 'vault-or-idle'
      ? buildVaultOrIdleLiquidityOptions(risk, governance)
      : buildLiquidityAdapterOptions(risk, governance);
  }, [risk, governance, variant]);

  const selected = options.find((o) => o.key === selectedKey) ?? null;
  const currentOption = options.find((o) => o.isCurrent) ?? null;

  const liquidityRaw = governance?.liquidity ?? null;
  const liquidityLabel =
    liquidityRaw != null
      ? formatAllocationTableAmount(BigInt(liquidityRaw), assetSymbol, dec)
      : '—';

  const buildWriteConfig = useCallback(
    (option: LiquidityAdapterOption) =>
      v2WriteConfigs.setLiquidityAdapterAndData(
        getAddress(vaultAddress),
        option.adapterAddress as Address,
        option.liquidityData
      ),
    [vaultAddress]
  );

  const closePanel = useCallback(() => {
    setChanging(false);
    setSelectedKey(null);
    setPreviewOpen(false);
    setTxPreview(null);
    setSubmitError(null);
    setQueueSafeError(null);
    write.reset();
  }, [write]);

  const openPanel = useCallback(() => {
    write.reset();
    setSelectedKey(currentOption?.key ?? options[0]?.key ?? null);
    setChanging(true);
  }, [write, currentOption?.key, options]);

  const openPreview = useCallback(() => {
    if (!selected || selected.isCurrent || !governance) return;

    setSubmitError(null);
    setQueueSafeError(null);
    setTxPreview(
      buildLiquidityAdapterPreview({
        currentLabel: display.label,
        selectedLabel: selected.label,
      })
    );
    setWriteDestination(
      coerceVaultWriteDestination(
        defaultAllocationDestination(allocators, walletAddress),
        {
          eligibleSafeRoles: eligibleAllocatorSafes,
          preferredSafeRole: ALLOCATION_SAFE_ROLE,
        }
      )
    );
    setPreviewOpen(true);
  }, [
    selected,
    governance,
    display.label,
    allocators,
    walletAddress,
    eligibleAllocatorSafes,
  ]);

  const runWalletSubmit = useCallback(async () => {
    if (!selected) return;

    setSubmitError(null);
    write.reset();

    try {
      await write.write(buildWriteConfig(selected));
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Failed to update liquidity adapter.');
    }
  }, [selected, buildWriteConfig, write]);

  const queueInSafe = useCallback(
    async (safeRole: SafeRole) => {
      if (!selected || !txPreview) return;

      setQueueingSafe(true);
      setQueueSafeError(null);

      try {
        const calldata = curatorWriteToCalldata(buildWriteConfig(selected));
        await queueSafeTransaction({
          safeRole,
          calldata,
          description: `Liquidity adapter — ${selected.label}`,
          preview: txPreview,
          source: {
            type: 'allocation',
            action: 'liquidity_adapter',
            vaultAddress: getAddress(vaultAddress),
            vaultSymbol: assetSymbol ?? undefined,
          },
          proposer: walletAddress ? getAddress(walletAddress) : undefined,
          provider: await getConnectorProvider(connector),
          safeAppSdk: allocatorSafeAppSdk,
        });
        setPreviewOpen(false);
        closePanel();
        router.push(`/safe/${safeRole}/transactions`);
      } catch (e) {
        setQueueSafeError(e instanceof Error ? e.message : 'Failed to queue Safe transaction.');
      } finally {
        setQueueingSafe(false);
      }
    },
    [
      selected,
      txPreview,
      buildWriteConfig,
      vaultAddress,
      assetSymbol,
      allocatorSafeAppSdk,
      closePanel,
      connector,
      router,
      walletAddress,
    ]
  );

  const handlePreviewConfirm = useCallback(async () => {
    if (
      !canConfirmVaultWriteDestination(writeDestination, {
        walletReady,
        eligibleSafeRoles: eligibleAllocatorSafes,
      })
    ) {
      if (writeDestination.kind === 'wallet') {
        setSubmitError(
          allocatorWalletHint ??
            'Connect an allocator wallet in the top bar, or queue in the Allocator Safe.'
        );
      } else {
        setQueueSafeError('Selected Safe is not an on-chain allocator for this vault.');
      }
      return;
    }

    if (writeDestination.kind === 'safe') {
      await queueInSafe(writeDestination.role);
      return;
    }
    await runWalletSubmit();
  }, [
    writeDestination,
    walletReady,
    eligibleAllocatorSafes,
    allocatorWalletHint,
    queueInSafe,
    runWalletSubmit,
  ]);

  if (!governance?.liquidityAdapter?.address && options.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      <CuratorPanel
        title="Liquidity adapter"
        actions={
          !changing ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={openPanel}
              disabled={options.length === 0}
            >
              Change
            </Button>
          ) : (
            <Button type="button" variant="ghost" size="sm" onClick={closePanel}>
              Cancel
            </Button>
          )
        }
      >
        <CuratorKvList>
          <CuratorKvRow label="Active adapter">
            {display.morphoHref ? (
              <a
                href={display.morphoHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex flex-wrap items-center justify-end gap-2"
              >
                <span className="font-medium text-blue-600 hover:underline dark:text-blue-400">
                  {display.label}
                </span>
                {display.lltv ? <AllocationPill>{display.lltv}</AllocationPill> : null}
              </a>
            ) : (
              <span className="inline-flex flex-wrap items-center justify-end gap-2">
                <span className="font-medium text-foreground">{display.label}</span>
                {display.lltv ? <AllocationPill>{display.lltv}</AllocationPill> : null}
              </span>
            )}
          </CuratorKvRow>
          <CuratorKvRow label="Current allocation">
            {liquidityLabel}
          </CuratorKvRow>
        </CuratorKvList>

        {changing ? (
          <div className="space-y-3 border-t border-border p-4">
            <p className="text-xs text-muted-foreground">
              {variant === 'vault-or-idle'
                ? 'Choose the Morpho vault this wrapper deposits through, or Idle so exits use only unallocated cash. '
                : 'Select the market that provides withdrawable liquidity. '}
              <span className="font-medium text-foreground">setLiquidityAdapterAndData</span> is an
              allocator action — it applies immediately (not timelocked).
            </p>
            <div className="max-h-64 space-y-1 overflow-y-auto">
              {options.map((option) => {
                const active = selectedKey === option.key;
                return (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => setSelectedKey(option.key)}
                    className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
                      active
                        ? 'border-border bg-muted'
                        : 'border-transparent hover:bg-muted/60'
                    }`}
                  >
                    <LiquidityMarketLabel option={option} />
                    {option.isCurrent ? (
                      <Badge variant="outline" className="shrink-0 text-[10px] font-normal">
                        Current
                      </Badge>
                    ) : null}
                  </button>
                );
              })}
            </div>

            {submitError ? (
              <TxErrorBanner
                error={submitError}
                onDismiss={() => setSubmitError(null)}
                className="text-xs"
              />
            ) : null}

            <Button
              type="button"
              disabled={!selected || selected.isCurrent}
              onClick={() => openPreview()}
            >
              Review change
            </Button>
          </div>
        ) : null}
      </CuratorPanel>

      <TxPreviewDialog
        open={previewOpen}
        preview={txPreview}
        onOpenChange={(open) => {
          if (!open && ((write.isLoading && isBroadcastTxHash(write.txHash)) || queueingSafe)) {
            return;
          }
          setPreviewOpen(open);
          if (!open) {
            setTxPreview(null);
            setSubmitError(null);
            setQueueSafeError(null);
            if (!isBroadcastTxHash(write.txHash)) write.reset();
          }
        }}
        destinationOptions={{
          destination: writeDestination,
          onDestinationChange: setWriteDestination,
          walletReady,
          walletHint: allocatorWalletHint,
          safeRoles: eligibleAllocatorSafes,
          confirmEnabled: canConfirmVaultWriteDestination(writeDestination, {
            walletReady,
            eligibleSafeRoles: eligibleAllocatorSafes,
          }),
        }}
        onConfirm={() => handlePreviewConfirm()}
        isLoading={writeDestination.kind === 'safe' ? queueingSafe : write.isLoading}
        error={
          submitError
            ? new Error(submitError)
            : queueSafeError
              ? new Error(queueSafeError)
              : write.error && writeDestination.kind === 'wallet'
                ? write.error
                : null
        }
      />
    </div>
  );
}
