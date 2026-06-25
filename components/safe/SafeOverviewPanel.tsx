'use client';

import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatRawTokenAmount } from '@/lib/format/number';
import { getScanUrlForChain } from '@/lib/constants';
import { BASE_CHAIN_ID } from '@/lib/constants';
import { useSafeInfo } from '@/lib/hooks/useSafeInfo';
import type { SafeAccountConfig } from '@/lib/safe/config';
import { safeAppHomeHref } from '@/lib/safe/links';

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="text-slate-500 dark:text-slate-400">{label}</span>
      <span className="text-right font-medium text-slate-900 dark:text-slate-100">{value}</span>
    </div>
  );
}

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
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Safe details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {infoLoading || !info ? (
            <Skeleton className="h-28 w-full" />
          ) : (
            <>
              <InfoRow
                label="ETH"
                value={infoLoading ? <span className="text-slate-400">Loading…</span> : (ethDisplay ?? '—')}
              />
              <InfoRow label="Nonce" value={info.nonce.toString()} />
              <InfoRow label="Version" value={info.version} />
              <InfoRow
                label="Address"
                value={
                  <a
                    href={`${getScanUrlForChain(BASE_CHAIN_ID)}/address/${account.address}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-mono text-xs break-all text-blue-600 hover:underline dark:text-blue-400"
                  >
                    {account.address}
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                }
              />
              <InfoRow
                label="Safe app"
                value={
                  <a
                    href={safeAppHomeHref(account.address)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline dark:text-blue-400"
                  >
                    app.safe.global
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                }
              />
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Owners</CardTitle>
          {info && !infoLoading && (
            <CardDescription>
              {formatThresholdLabel(info.threshold, info.owners.length)} threshold
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          {infoLoading || !info ? (
            <Skeleton className="h-28 w-full" />
          ) : (
            <ul className="space-y-2">
              {info.owners.map((owner) => (
                <li key={owner}>
                  <a
                    href={`${getScanUrlForChain(BASE_CHAIN_ID)}/address/${owner}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-xs text-slate-700 hover:text-blue-600 dark:text-slate-300 dark:hover:text-blue-400"
                  >
                    {owner}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Proposers</CardTitle>
          <CardDescription>
            Addresses authorized to propose transactions via the Safe Transaction Service
          </CardDescription>
        </CardHeader>
        <CardContent>
          {infoLoading || !info ? (
            <Skeleton className="h-28 w-full" />
          ) : !info.proposersConfigured ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Set{' '}
              <code className="rounded bg-slate-100 px-1 py-0.5 text-xs dark:bg-slate-800">
                NEXT_PUBLIC_SAFE_API_KEY
              </code>{' '}
              to load proposers from the Transaction Service.
            </p>
          ) : info.proposersError ? (
            <p className="text-sm text-red-600 dark:text-red-400">{info.proposersError}</p>
          ) : info.proposers.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">None configured</p>
          ) : (
            <ul className="space-y-3">
              {info.proposers.map((proposer) => (
                <li key={proposer.address} className="space-y-0.5">
                  <a
                    href={`${getScanUrlForChain(BASE_CHAIN_ID)}/address/${proposer.address}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-xs text-slate-700 hover:text-blue-600 dark:text-slate-300 dark:hover:text-blue-400"
                  >
                    {proposer.address}
                  </a>
                  {proposer.label ? (
                    <p className="text-xs text-slate-500 dark:text-slate-400">{proposer.label}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {account.role === 'allocator' && (
        <p className="lg:col-span-3 text-xs text-slate-500 dark:text-slate-400">
          Vault rebalances queued from the Allocation tab appear in the transaction queue below.
          Choose{' '}
          <span className="font-medium text-slate-700 dark:text-slate-300">Queue in Allocator Safe</span>{' '}
          in the preview dialog.
        </p>
      )}
      {account.role === 'sentinel' && (
        <p className="lg:col-span-3 text-xs text-slate-500 dark:text-slate-400">
          Cap decreases and deallocations queued from a vault&apos;s{' '}
          <span className="font-medium text-slate-700 dark:text-slate-300">Sentinel</span>{' '}
          tab appear in the transaction queue below. Choose{' '}
          <span className="font-medium text-slate-700 dark:text-slate-300">Queue in Sentinel Safe</span>{' '}
          in the preview dialog.
        </p>
      )}
    </div>
  );
}

export function SafeRoleHeader({ account }: { account: SafeAccountConfig }) {
  return (
    <div className="space-y-1">
      <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{account.label}</h2>
      <p className="text-sm text-slate-500 dark:text-slate-400">{account.description}</p>
    </div>
  );
}

export function SafeVaultLink({ vaultAddress, vaultSymbol }: { vaultAddress: string; vaultSymbol?: string }) {
  return (
    <Link
      href={`/vault/v2/${vaultAddress}`}
      className="text-xs text-blue-600 hover:underline dark:text-blue-400"
    >
      {vaultSymbol ? `${vaultSymbol} vault` : 'View vault'} →
    </Link>
  );
}
