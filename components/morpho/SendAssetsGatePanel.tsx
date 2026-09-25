'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useAccount } from 'wagmi';
import { getAddress, isAddress, type Address, type Hex } from 'viem';
import { AddressBadge } from '@/components/AddressBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { TxPreviewDialog } from '@/components/morpho/TxPreviewDialog';
import {
  CuratorEmptyText,
  CuratorErrorText,
  CuratorKvList,
  CuratorKvRow,
  CuratorPanel,
} from '@/components/morpho/CuratorChrome';
import { TxErrorBanner } from '@/components/TxErrorBanner';
import { apiFetch } from '@/lib/data/api-fetch';
import { ON_CHAIN_VAULT_QUERY_OPTIONS } from '@/lib/data/query-config';
import type { SendAssetsGateState } from '@/app/api/gates/[address]/route';
import {
  encodeGateSetIsWhitelisted,
  encodeGateSetIsWhitelister,
} from '@/lib/morpho/vault-v2-gates';
import type { TxPreview } from '@/lib/morpho/tx-preview';
import type { SafeRole } from '@/lib/safe/config';
import { queueSafeTransaction } from '@/lib/safe/queue-vault-write';
import { getConnectorProvider } from '@/lib/wallet/connector-provider';
import { useCuratorSafeApps } from '@/lib/safe/safe-apps-context';
import {
  canConfirmVaultWriteDestination,
  confirmLabelForDestination,
  type VaultWriteDestination,
} from '@/lib/safe/vault-write-destination';
import { BASE_CHAIN_ID, getScanUrlForChain } from '@/lib/constants';
import { stripGroupingSeparators } from '@/lib/format/allocation-display';
import { isWalletRejection } from '@/lib/utils/wallet-error';

type GateWriteKind = 'whitelist' | 'whitelister';

const WHITELIST_ROLES: SafeRole[] = ['allocator', 'curator'];
const WHITELISTER_ROLES: SafeRole[] = ['curator'];

const GATE_SCAN_POLL_MS = 3_000;

function gateQueryKey(address: string) {
  return ['send-assets-gate', address] as const;
}

function short(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function previewFor(
  kind: GateWriteKind,
  account: Address,
  allowed: boolean
): TxPreview {
  const verb = allowed ? 'Allow' : 'Revoke';
  const what = kind === 'whitelist' ? 'depositor / adapter' : 'whitelister';
  return {
    title: `${verb} ${what}`,
    description: `${account} — ${allowed ? 'true' : 'false'}`,
    changes: [
      {
        action: 'gate',
        label: short(account),
        after: allowed ? 'true' : 'false',
      },
    ],
    footnote:
      kind === 'whitelist'
        ? 'Allocator or Curator Safe (whitelister) can change the deposit allowlist.'
        : 'Only the gate roleSetter (Curator Safe) can appoint or revoke whitelisters.',
  };
}

function GateRoster({
  title,
  description,
  rows,
  empty,
}: {
  title: string;
  description: string;
  rows: SendAssetsGateState['accounts'];
  empty: string;
}) {
  const scan = getScanUrlForChain(BASE_CHAIN_ID);
  return (
    <CuratorPanel title={title} description={description}>
      {rows.length === 0 ? (
        <div className="px-4 py-3">
          <CuratorEmptyText>{empty}</CuratorEmptyText>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((row) => (
            <li key={row.address} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
              <p className="text-sm text-foreground">{row.label}</p>
              <AddressBadge
                address={row.address}
                truncate
                scanUrl={`${scan}/address/${row.address}`}
              />
            </li>
          ))}
        </ul>
      )}
    </CuratorPanel>
  );
}

function GateRosters({ state }: { state: SendAssetsGateState }) {
  const unreadable = state.accounts.filter(
    (row) => row.isWhitelisted == null || row.isWhitelister == null
  );
  const scan = state.rosterScan ?? { status: 'failed' as const, progress: 0 };
  return (
    <>
      {scan.status !== 'complete' || unreadable.length > 0 ? (
        <div className="space-y-1 rounded-xl border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-xs text-amber-700 dark:text-amber-400">
          {scan.status === 'scanning' ? (
            <p>
              Scanning the gate&apos;s event history (
              {Math.floor(scan.progress * 100)}% done). Accounts added outside
              this app&apos;s config may be missing until it finishes.
            </p>
          ) : null}
          {scan.status === 'failed' ? (
            <p>
              Could not scan the gate&apos;s event history. The lists below only cover
              configured accounts, so an address added elsewhere may be missing.
            </p>
          ) : null}
          {unreadable.length > 0 ? (
            <p>
              Could not read {unreadable.length} account
              {unreadable.length === 1 ? '' : 's'} from the gate:{' '}
              {unreadable.map((row) => short(row.address)).join(', ')}. They are left out
              of the lists below.
            </p>
          ) : null}
        </div>
      ) : null}

      <GateRoster
        title="Whitelisters"
        description="Accounts isWhitelister() returns true for. They can change the deposit allowlist."
        rows={state.accounts.filter((row) => row.isWhitelister === true)}
        empty="No whitelisters on this gate."
      />

      <GateRoster
        title="Whitelisted"
        description="Accounts isWhitelisted() returns true for. They can deposit into gated vaults."
        rows={state.accounts.filter((row) => row.isWhitelisted === true)}
        empty="No whitelisted accounts on this gate."
      />
    </>
  );
}

export function SendAssetsGatePanel({
  gateAddress,
  label,
}: {
  gateAddress: Address;
  label: string;
}) {
  const router = useRouter();
  const { address: walletAddress, connector } = useAccount();
  const { connected: safeAppConnected, sdk: safeAppSdk, safeRole: safeAppRole } =
    useCuratorSafeApps();
  const query = useQuery({
    queryKey: gateQueryKey(gateAddress),
    queryFn: async () => {
      const res = await apiFetch(`/api/gates/${gateAddress}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
        throw new Error(body.message || body.error || 'Failed to load gate');
      }
      return (await res.json()) as SendAssetsGateState;
    },
    ...ON_CHAIN_VAULT_QUERY_OPTIONS,
    // The server scans gate history a few seconds per request; poll until done.
    refetchInterval: (q) =>
      q.state.data?.rosterScan?.status === 'scanning' ? GATE_SCAN_POLL_MS : false,
  });

  const [accountInput, setAccountInput] = useState('');
  const [kind, setKind] = useState<GateWriteKind>('whitelist');
  const [allowed, setAllowed] = useState(true);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [destination, setDestination] = useState<VaultWriteDestination>({
    kind: 'safe',
    role: 'allocator',
  });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const parsedAccount = isAddress(stripGroupingSeparators(accountInput))
    ? getAddress(stripGroupingSeparators(accountInput))
    : null;

  const eligibleRoles = kind === 'whitelist' ? WHITELIST_ROLES : WHITELISTER_ROLES;

  const preview = useMemo(
    () => (parsedAccount ? previewFor(kind, parsedAccount, allowed) : null),
    [parsedAccount, kind, allowed]
  );

  const coercedDestination = useMemo((): VaultWriteDestination => {
    if (destination.kind === 'safe' && !eligibleRoles.includes(destination.role)) {
      return { kind: 'safe', role: eligibleRoles[0]! };
    }
    return destination;
  }, [destination, eligibleRoles]);

  const gateSafeAppSdk = useMemo(() => {
    if (
      !safeAppConnected ||
      !safeAppSdk ||
      coercedDestination.kind !== 'safe' ||
      safeAppRole !== coercedDestination.role
    ) {
      return null;
    }
    return safeAppSdk;
  }, [safeAppConnected, safeAppSdk, safeAppRole, coercedDestination]);

  async function confirm() {
    if (!parsedAccount) return;
    setBusy(true);
    setError(null);
    try {
      const data: Hex =
        kind === 'whitelist'
          ? encodeGateSetIsWhitelisted(parsedAccount, allowed)
          : encodeGateSetIsWhitelister(parsedAccount, allowed);
      if (coercedDestination.kind !== 'safe') {
        throw new Error('Connect a Safe owner path — gate writes go through Allocator or Curator Safe.');
      }
      await queueSafeTransaction({
        safeRole: coercedDestination.role,
        calldata: { to: gateAddress, data },
        description: `${preview?.title ?? 'Gate update'} — ${short(parsedAccount)}`,
        preview: preview!,
        source: {
          type: 'gate',
          action: kind === 'whitelist' ? 'set_whitelisted' : 'set_whitelister',
          gateAddress,
        },
        proposer: walletAddress,
        provider: await getConnectorProvider(connector),
        safeAppSdk: gateSafeAppSdk,
      });
      router.push(`/safe/${coercedDestination.role}/transactions`);
    } catch (err) {
      if (isWalletRejection(err)) return;
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <CuratorPanel title={label} description="WhitelistSendAssetsGate — who may deposit into gated underlying vaults.">
        {query.isLoading ? (
          <div className="p-4">
            <Skeleton className="h-24 w-full" />
          </div>
        ) : query.error || !query.data ? (
          <div className="px-4 py-3">
            <CuratorErrorText>
              {query.error instanceof Error ? query.error.message : 'Failed to load gate'}
            </CuratorErrorText>
          </div>
        ) : (
          <CuratorKvList>
            <CuratorKvRow label="Gate">
              <AddressBadge
                address={query.data.address}
                truncate
                scanUrl={`${getScanUrlForChain(BASE_CHAIN_ID)}/address/${query.data.address}`}
              />
            </CuratorKvRow>
            <CuratorKvRow label="Role setter" description="Appoints whitelisters (Curator Safe)">
              {query.data.roleSetter ? (
                <AddressBadge
                  address={query.data.roleSetter}
                  truncate
                  label="auto"
                  scanUrl={`${getScanUrlForChain(BASE_CHAIN_ID)}/address/${query.data.roleSetter}`}
                />
              ) : (
                '—'
              )}
            </CuratorKvRow>
          </CuratorKvList>
        )}
      </CuratorPanel>

      {query.isLoading ? (
        <CuratorPanel title="Whitelisters" description="Loading gate roster…">
          <div className="p-4">
            <Skeleton className="h-24 w-full" />
          </div>
        </CuratorPanel>
      ) : query.data ? (
        <GateRosters state={query.data} />
      ) : null}

      <CuratorPanel
        title="Update gate"
        description="Queue setIsWhitelisted (Allocator / Curator) or setIsWhitelister (Curator only)."
      >
        <div className="space-y-3 p-4">
          <div className="flex flex-wrap gap-3 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={kind === 'whitelist'}
                onChange={() => {
                  setKind('whitelist');
                  setDestination({ kind: 'safe', role: 'allocator' });
                }}
              />
              Deposit allowlist
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={kind === 'whitelister'}
                onChange={() => {
                  setKind('whitelister');
                  setDestination({ kind: 'safe', role: 'curator' });
                }}
              />
              Whitelister role
            </label>
          </div>
          <Input
            placeholder="0x account"
            value={accountInput}
            onChange={(e) => setAccountInput(e.target.value)}
            className="font-mono text-xs"
          />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={allowed} onChange={(e) => setAllowed(e.target.checked)} />
            Allow (uncheck to revoke)
          </label>
          {error != null ? <TxErrorBanner error={error} onDismiss={() => setError(null)} /> : null}
          <Button
            disabled={!parsedAccount}
            onClick={() => {
              setError(null);
              setPreviewOpen(true);
            }}
          >
            Review
          </Button>
        </div>
      </CuratorPanel>

      <TxPreviewDialog
        open={previewOpen}
        preview={preview}
        onOpenChange={setPreviewOpen}
        onConfirm={() => void confirm()}
        isLoading={busy}
        error={error}
        destinationOptions={{
          destination: coercedDestination,
          onDestinationChange: setDestination,
          walletReady: false,
          walletHint: `${confirmLabelForDestination({ kind: 'safe', role: eligibleRoles[0]! })} — gate writes are Safe-only.`,
          safeRoles: eligibleRoles,
          confirmEnabled: canConfirmVaultWriteDestination(coercedDestination, {
            walletReady: false,
            eligibleSafeRoles: eligibleRoles,
          }),
        }}
      />
    </div>
  );
}
