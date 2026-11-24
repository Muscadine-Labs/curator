'use client';

import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Send, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { CuratorEmptyText, CuratorErrorText, CuratorPanel } from '@/components/morpho/CuratorChrome';
import { SafeSendDialog } from '@/components/safe/SafeSendDialog';
import { formatRawTokenAmount } from '@/lib/format/number';
import type { SafeAccountConfig } from '@/lib/safe/config';
import { addCustomToken, removeCustomToken } from '@/lib/safe/custom-token-store';
import { isNativeToken, SAFE_AMOUNT_DP } from '@/lib/safe/tokens';
import type { SafeTokenBalance } from '@/lib/safe/read-balances';
import { safeBalancesQueryKey, useCustomTokens, useSafeBalances } from '@/lib/hooks/useSafeBalances';

function AddTokenForm({
  account,
  onAdded,
}: {
  account: SafeAccountConfig;
  onAdded: (token: string) => void;
}) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="flex flex-wrap items-start gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        try {
          addCustomToken(account.role, value.trim());
          onAdded(value.trim());
          setValue('');
          setError(null);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Could not add token.');
        }
      }}
    >
      <div className="min-w-[16rem] flex-1 space-y-1">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Track another token — 0x…"
          spellCheck={false}
          className="font-mono text-xs"
        />
        {error ? <p className="text-xs text-red-600 dark:text-red-400">{error}</p> : null}
      </div>
      <Button type="submit" variant="outline" size="sm" disabled={value.trim().length === 0}>
        <Plus className="mr-1 h-3.5 w-3.5" />
        Add
      </Button>
    </form>
  );
}

export function SafeAssetsPanel({ account }: { account: SafeAccountConfig }) {
  const queryClient = useQueryClient();
  const customTokens = useCustomTokens(account.role);
  const { data: balances, isLoading, error } = useSafeBalances(account.address, account.role);
  const [sendOpen, setSendOpen] = useState(false);
  const [sendToken, setSendToken] = useState<string | undefined>();
  const [showZero, setShowZero] = useState(false);

  const customSet = useMemo(
    () => new Set(customTokens.map((t) => t.toLowerCase())),
    [customTokens]
  );

  const rows = useMemo(() => {
    const all = balances ?? [];
    const visible = showZero ? all : all.filter((b) => b.balance > 0n);
    return [...visible].sort((a, b) => {
      if (a.kind === 'native') return -1;
      if (b.kind === 'native') return 1;
      if (a.kind !== b.kind) return a.kind === 'vaultShare' ? 1 : -1;
      return a.symbol.localeCompare(b.symbol);
    });
  }, [balances, showZero]);

  function openSend(token?: SafeTokenBalance) {
    setSendToken(token ? String(token.address) : undefined);
    setSendOpen(true);
  }

  return (
    <>
      <CuratorPanel
        title="Assets"
        description="On-chain balances for this Safe on Base"
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowZero((v) => !v)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              {showZero ? 'Hide zero balances' : 'Show zero balances'}
            </button>
            <Button size="sm" onClick={() => openSend()} disabled={!balances}>
              <Send className="mr-1 h-3.5 w-3.5" />
              Send
            </Button>
          </div>
        }
      >
        {isLoading ? (
          <div className="p-4">
            <Skeleton className="h-32 w-full" />
          </div>
        ) : error ? (
          <div className="px-4 py-3">
            <CuratorErrorText>
              {error instanceof Error ? error.message : 'Failed to load balances.'}
            </CuratorErrorText>
          </div>
        ) : rows.length === 0 ? (
          <div className="px-4 py-3">
            <CuratorEmptyText>
              No balances. {showZero ? '' : 'Toggle “Show zero balances” to see tracked tokens.'}
            </CuratorEmptyText>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((token) => {
              const key = String(token.address);
              const isCustom = !isNativeToken(token.address) && customSet.has(key.toLowerCase());
              return (
                <li key={key} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-foreground">
                      {token.symbol}
                      {token.kind === 'vaultShare' ? (
                        <span className="ml-1.5 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
                          vault
                        </span>
                      ) : null}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{token.name}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs tabular-nums text-foreground">
                      {formatRawTokenAmount(token.balance, token.decimals, SAFE_AMOUNT_DP)}
                    </span>
                    {token.balance > 0n ? (
                      <Button size="sm" variant="ghost" onClick={() => openSend(token)}>
                        Send
                      </Button>
                    ) : null}
                    {isCustom ? (
                      <button
                        type="button"
                        aria-label={`Stop tracking ${token.symbol}`}
                        onClick={() => {
                          removeCustomToken(account.role, token.address as `0x${string}`);
                          queryClient.invalidateQueries({
                            queryKey: safeBalancesQueryKey(account.address, customTokens),
                          });
                        }}
                        className="text-muted-foreground transition hover:text-red-600"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <div className="border-t border-border px-4 py-3">
          <AddTokenForm
            account={account}
            onAdded={() => {
              queryClient.invalidateQueries({
                queryKey: ['safe-balances', account.address],
              });
            }}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            Balances are read on-chain for a curated token set. A Safe can hold any token — add
            one by address to track it here. If it does not appear, the address is not a readable
            ERC-20 on Base.
          </p>
        </div>
      </CuratorPanel>

      {/* Mounted only while open so each launch starts from the clicked asset
          rather than reusing the previous dialog's state. */}
      {sendOpen ? (
        <SafeSendDialog
          account={account}
          balances={balances ?? []}
          open
          onOpenChange={setSendOpen}
          initialToken={sendToken}
        />
      ) : null}
    </>
  );
}
