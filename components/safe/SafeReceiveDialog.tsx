'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAccount, useBalance, useReadContract } from 'wagmi';
import { erc20Abi, parseUnits, type Address } from 'viem';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TxErrorBanner } from '@/components/TxErrorBanner';
import { AmountMaxInput } from '@/components/morpho/AmountMaxInput';
import { SafeModal } from '@/components/safe/SafeModal';
import { stripGroupingSeparators } from '@/lib/format/allocation-display';
import { BASE_CHAIN_ID, getScanUrlForChain } from '@/lib/constants';
import type { SafeAccountConfig } from '@/lib/safe/config';
import type { SafeTokenBalance } from '@/lib/safe/read-balances';
import { isNativeToken } from '@/lib/safe/tokens';
import { useSafeFunding } from '@/lib/hooks/useSafeFunding';
import { safeBalancesQueryKey, useCustomTokens } from '@/lib/hooks/useSafeBalances';
import { cn } from '@/lib/utils';

/** Safe addresses are chain-prefixed everywhere in the Safe UI. */
function prefixedAddress(address: string): string {
  return `base:${address}`;
}

/**
 * `qrcode` is ~30KB and only ever needed once this dialog is open, so it is
 * imported on demand rather than shipped with every Safe page.
 */
function useQrDataUrl(value: string): { dataUrl: string | null; failed: boolean } {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    import('qrcode')
      .then((mod) =>
        (mod.default ?? mod).toDataURL(value, {
          margin: 1,
          width: 320,
          errorCorrectionLevel: 'M',
        })
      )
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [value]);

  return { dataUrl, failed };
}

function CopyRow({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="flex w-full items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-left transition hover:bg-muted"
    >
      <span className="break-all font-mono text-xs text-foreground">{value}</span>
      {copied ? (
        <Check className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
      ) : (
        <Copy className="h-4 w-4 shrink-0 text-muted-foreground" />
      )}
    </button>
  );
}

export function SafeReceiveDialog({
  account,
  balances,
  open,
  onOpenChange,
}: {
  account: SafeAccountConfig;
  balances: ReadonlyArray<SafeTokenBalance>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { address: walletAddress, isConnected } = useAccount();
  const customTokens = useCustomTokens(account.role);
  const qr = useQrDataUrl(prefixedAddress(account.address));
  const funding = useSafeFunding();

  const fundable = useMemo(
    () => balances.filter((b) => b.kind !== 'vaultShare'),
    [balances]
  );
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [amount, setAmount] = useState('');

  const selected = fundable.find((t) => String(t.address) === selectedKey) ?? fundable[0] ?? null;

  const { data: nativeBalance } = useBalance({
    address: walletAddress,
    chainId: BASE_CHAIN_ID,
    query: { enabled: Boolean(walletAddress) && selected != null && isNativeToken(selected.address) },
  });

  const { data: erc20Balance } = useReadContract({
    address: selected && !isNativeToken(selected.address) ? (selected.address as Address) : undefined,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: walletAddress ? [walletAddress] : undefined,
    chainId: BASE_CHAIN_ID,
    query: {
      enabled: Boolean(walletAddress) && selected != null && !isNativeToken(selected.address),
    },
  });

  const walletBalance = selected
    ? isNativeToken(selected.address)
      ? (nativeBalance?.value ?? null)
      : ((erc20Balance as bigint | undefined) ?? null)
    : null;

  const parsedAmount = useMemo(() => {
    if (!selected) return 0n;
    try {
      const cleaned = stripGroupingSeparators(amount);
      if (!cleaned || cleaned === '.') return 0n;
      return parseUnits(cleaned, selected.decimals);
    } catch {
      return 0n;
    }
  }, [amount, selected]);

  useEffect(() => {
    if (funding.isSuccess) {
      queryClient.invalidateQueries({
        queryKey: safeBalancesQueryKey(account.address, customTokens),
      });
    }
  }, [funding.isSuccess, queryClient, account.address, customTokens]);

  const overBalance = walletBalance != null && parsedAmount > walletBalance;
  const canSend =
    isConnected &&
    selected != null &&
    parsedAmount > 0n &&
    !overBalance &&
    !funding.isPending &&
    !funding.isConfirming;

  return (
    <SafeModal
      open={open}
      title="Receive"
      description={`Fund the ${account.label} Safe`}
      onOpenChange={(next) => {
        if (!next) {
          setAmount('');
          funding.reset();
        }
        onOpenChange(next);
      }}
      locked={funding.isPending}
    >
      <div className="space-y-5">
        <div className="space-y-3">
          <div className="flex justify-center">
            {qr.dataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={qr.dataUrl}
                alt={`QR code for ${account.address}`}
                className="h-40 w-40 rounded-md border border-border bg-white p-2"
              />
            ) : qr.failed ? (
              <div className="flex h-40 w-40 items-center justify-center rounded-md border border-border p-3 text-center text-xs text-muted-foreground">
                QR code unavailable — copy the address below.
              </div>
            ) : (
              <div className="h-40 w-40 animate-pulse rounded-md bg-muted" />
            )}
          </div>
          <CopyRow value={prefixedAddress(account.address)} />
          <p className="text-xs text-muted-foreground">
            Only send assets on <span className="font-medium text-foreground">Base</span>. Tokens
            sent on another network will not appear here and may be unrecoverable.
          </p>
        </div>

        <div className="space-y-3 border-t border-border pt-4">
          <div>
            <h3 className="text-xs font-semibold text-foreground">Send from your wallet</h3>
            <p className="text-xs text-muted-foreground">
              A direct transfer — no Safe signatures needed to receive.
            </p>
          </div>

          {!isConnected ? (
            <p className="text-xs text-muted-foreground">
              Connect a wallet in the top bar to fund this Safe from here.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-1">
                {fundable.map((token) => {
                  const active = selected != null && String(token.address) === String(selected.address);
                  return (
                    <button
                      key={String(token.address)}
                      type="button"
                      onClick={() => {
                        setSelectedKey(String(token.address));
                        setAmount('');
                      }}
                      className={cn(
                        'rounded-md border px-2.5 py-1 text-xs font-medium transition',
                        active
                          ? 'border-blue-500 bg-blue-50 text-foreground dark:bg-blue-950/30'
                          : 'border-border text-muted-foreground hover:bg-muted'
                      )}
                    >
                      {token.symbol}
                    </button>
                  );
                })}
              </div>

              {selected ? (
                <AmountMaxInput
                  id="safe-fund-amount"
                  label="Amount"
                  symbol={selected.symbol}
                  decimals={selected.decimals}
                  value={amount}
                  onChange={setAmount}
                  maxRaw={walletBalance}
                  availableCaption="Your balance"
                  disabled={funding.isPending}
                />
              ) : null}

              {overBalance ? (
                <p className="text-xs text-red-600 dark:text-red-400">
                  Amount exceeds your wallet balance.
                </p>
              ) : null}
              {funding.error != null ? (
                <TxErrorBanner error={funding.error} onDismiss={funding.reset} />
              ) : null}
              {funding.txHash ? (
                <a
                  href={`${getScanUrlForChain(BASE_CHAIN_ID)}/tx/${funding.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline dark:text-blue-400"
                >
                  {funding.isConfirming
                    ? 'Confirming…'
                    : funding.isSuccess
                      ? 'Confirmed'
                      : funding.isFailed
                        ? 'Failed'
                        : 'Submitted'}{' '}
                  — view transaction
                  <ExternalLink className="h-3 w-3" />
                </a>
              ) : null}

              <Button
                className="w-full"
                disabled={!canSend}
                onClick={() => {
                  if (!selected) return;
                  funding
                    .fund({
                      safeAddress: account.address,
                      token: selected.address,
                      amount: parsedAmount,
                    })
                    .catch(() => undefined);
                }}
              >
                {funding.isPending ? 'Confirm in wallet…' : 'Send to Safe'}
              </Button>
            </>
          )}
        </div>
      </div>
    </SafeModal>
  );
}
