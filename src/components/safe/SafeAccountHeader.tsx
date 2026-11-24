'use client';

import { useState } from 'react';
import { ArrowDownToLine, Check, Copy, ExternalLink, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { SafeSendDialog } from '@/components/safe/SafeSendDialog';
import { SafeReceiveDialog } from '@/components/safe/SafeReceiveDialog';
import { formatRawTokenAmount } from '@/lib/format/number';
import { BASE_CHAIN_ID, getScanUrlForChain } from '@/lib/constants';
import type { SafeAccountConfig } from '@/lib/safe/config';
import { safeAppHomeHref } from '@/lib/safe/links';
import { useSafeInfo } from '@/lib/hooks/useSafeInfo';
import { useSafeBalances } from '@/lib/hooks/useSafeBalances';

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function SafeAccountHeader({ account }: { account: SafeAccountConfig }) {
  const { data: info, isLoading } = useSafeInfo(account.address);
  const { data: balances } = useSafeBalances(account.address, account.role);
  const [copied, setCopied] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);

  const prefixed = `base:${account.address}`;

  return (
    <>
      <div className="flex flex-col gap-4 rounded-xl border border-border p-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-foreground">{account.label}</h2>
            {isLoading || !info ? (
              <Skeleton className="h-5 w-14" />
            ) : (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
                {info.threshold}/{info.owners.length}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{account.description}</p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(prefixed).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                });
              }}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 font-mono text-xs text-foreground transition hover:bg-muted"
              title={prefixed}
            >
              {shortAddress(account.address)}
              {copied ? (
                <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <Copy className="h-3 w-3 text-muted-foreground" />
              )}
            </button>
            <a
              href={`${getScanUrlForChain(BASE_CHAIN_ID)}/address/${account.address}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline dark:text-blue-400"
            >
              Basescan
              <ExternalLink className="h-3 w-3" />
            </a>
            <a
              href={safeAppHomeHref(account.address)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline dark:text-blue-400"
            >
              app.safe.global
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-start gap-3 sm:items-end">
          <div className="sm:text-right">
            <p className="text-xs text-muted-foreground">ETH balance</p>
            {isLoading || !info ? (
              <Skeleton className="mt-1 h-5 w-24" />
            ) : (
              <p className="text-sm font-semibold tabular-nums text-foreground">
                {formatRawTokenAmount(info.ethBalance, 18, 6)} ETH
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => setSendOpen(true)} disabled={!balances}>
              <Send className="mr-1 h-3.5 w-3.5" />
              Send
            </Button>
            <Button size="sm" variant="outline" onClick={() => setReceiveOpen(true)}>
              <ArrowDownToLine className="mr-1 h-3.5 w-3.5" />
              Receive
            </Button>
          </div>
        </div>
      </div>

      {sendOpen ? (
        <SafeSendDialog
          account={account}
          balances={balances ?? []}
          open
          onOpenChange={setSendOpen}
        />
      ) : null}
      {receiveOpen ? (
        <SafeReceiveDialog
          account={account}
          balances={balances ?? []}
          open
          onOpenChange={setReceiveOpen}
        />
      ) : null}
    </>
  );
}
