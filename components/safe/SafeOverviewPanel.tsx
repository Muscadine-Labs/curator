'use client';

import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { formatRawTokenAmount } from '@/lib/format/number';
import { getScanUrlForChain } from '@/lib/constants';
import { BASE_CHAIN_ID } from '@/lib/constants';
import { useSafeInfo } from '@/lib/hooks/useSafeInfo';
import type { SafeAccountConfig } from '@/lib/safe/config';
import { safeAppHomeHref } from '@/lib/safe/links';
import {
  CuratorEmptyText,
  CuratorErrorText,
  CuratorKvList,
  CuratorKvRow,
  CuratorPanel,
} from '@/components/morpho/CuratorChrome';

function formatThresholdLabel(threshold: number, ownerCount: number): string {
  return `${threshold}/${ownerCount}`;
}

export function SafeOverviewPanel({ account }: { account: SafeAccountConfig }) {
  const { data: info, isLoading: infoLoading } = useSafeInfo(account.address);

  const ethDisplay =
    info != null
      ? `${formatRawTokenAmount(info.ethBalance, 18, 6)} ETH`
      : null;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <CuratorPanel title="Safe details">
        {infoLoading || !info ? (
          <div className="p-4">
            <Skeleton className="h-28 w-full" />
          </div>
        ) : (
          <CuratorKvList>
            <CuratorKvRow label="ETH">
              {infoLoading ? <span className="text-muted-foreground">Loading…</span> : (ethDisplay ?? '—')}
            </CuratorKvRow>
            <CuratorKvRow label="Nonce">{info.nonce.toString()}</CuratorKvRow>
            <CuratorKvRow label="Version">{info.version}</CuratorKvRow>
            <CuratorKvRow label="Address">
              <a
                href={`${getScanUrlForChain(BASE_CHAIN_ID)}/address/${account.address}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 break-all font-mono text-xs text-blue-600 hover:underline dark:text-blue-400"
              >
                {account.address}
                <ExternalLink className="h-3 w-3 shrink-0" />
              </a>
            </CuratorKvRow>
            <CuratorKvRow label="Safe app">
              <a
                href={safeAppHomeHref(account.address)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline dark:text-blue-400"
              >
                app.safe.global
                <ExternalLink className="h-3 w-3 shrink-0" />
              </a>
            </CuratorKvRow>
          </CuratorKvList>
        )}
      </CuratorPanel>

      <CuratorPanel
        title="Owners"
        description={
          info && !infoLoading
            ? `${formatThresholdLabel(info.threshold, info.owners.length)} threshold`
            : undefined
        }
      >
        {infoLoading || !info ? (
          <div className="p-4">
            <Skeleton className="h-28 w-full" />
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {info.owners.map((owner) => (
              <li key={owner} className="px-4 py-3">
                <a
                  href={`${getScanUrlForChain(BASE_CHAIN_ID)}/address/${owner}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-xs text-foreground hover:text-blue-600 dark:hover:text-blue-400"
                >
                  {owner}
                </a>
              </li>
            ))}
          </ul>
        )}
      </CuratorPanel>

      <CuratorPanel
        title="Proposers"
        description="Addresses authorized to propose transactions via the Safe Queue Service"
      >
        {infoLoading || !info ? (
          <div className="p-4">
            <Skeleton className="h-28 w-full" />
          </div>
        ) : !info.proposersConfigured ? (
          <div className="px-4 py-3">
            <CuratorEmptyText>
              Set{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                NEXT_PUBLIC_SAFE_API_KEY
              </code>{' '}
              to load proposers from the Safe Queue Service.
            </CuratorEmptyText>
          </div>
        ) : info.proposersError ? (
          <div className="px-4 py-3">
            <CuratorErrorText>{info.proposersError}</CuratorErrorText>
          </div>
        ) : info.proposers.length === 0 ? (
          <div className="px-4 py-3">
            <CuratorEmptyText>None configured</CuratorEmptyText>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {info.proposers.map((proposer) => (
              <li key={proposer.address} className="space-y-0.5 px-4 py-3">
                <a
                  href={`${getScanUrlForChain(BASE_CHAIN_ID)}/address/${proposer.address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-xs text-foreground hover:text-blue-600 dark:hover:text-blue-400"
                >
                  {proposer.address}
                </a>
                {proposer.label ? (
                  <p className="text-xs text-muted-foreground">{proposer.label}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CuratorPanel>

      {account.role === 'allocator' && (
        <p className="text-xs text-muted-foreground lg:col-span-3">
          Vault rebalances queued from the Allocation tab appear in the Transactions tab. Choose{' '}
          <span className="font-medium text-foreground">Queue in Allocator Safe</span> in the
          preview dialog.
        </p>
      )}
      {account.role === 'sentinel' && (
        <p className="text-xs text-muted-foreground lg:col-span-3">
          Cap decreases and deallocations queued from a vault&apos;s{' '}
          <span className="font-medium text-foreground">Sentinel</span> tab appear in the
          Transactions tab. Choose{' '}
          <span className="font-medium text-foreground">Queue in Sentinel Safe</span> in the
          preview dialog.
        </p>
      )}
    </div>
  );
}

export function SafeVaultLink({ vaultAddress, vaultSymbol }: { vaultAddress: string; vaultSymbol?: string }) {
  return (
    <Link
      href={`/vault/${vaultAddress}`}
      className="text-xs text-blue-600 hover:underline dark:text-blue-400"
    >
      {vaultSymbol ? `${vaultSymbol} vault` : 'View vault'} →
    </Link>
  );
}
