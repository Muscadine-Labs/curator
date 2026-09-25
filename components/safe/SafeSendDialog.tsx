'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAccount } from 'wagmi';
import { useSyncExternalStore } from 'react';
import { getAddress, isAddress, parseUnits, zeroAddress } from 'viem';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TxErrorBanner } from '@/components/TxErrorBanner';
import { Input } from '@/components/ui/input';
import { AmountMaxInput } from '@/components/morpho/AmountMaxInput';
import { SafeModal } from '@/components/safe/SafeModal';
import { stripGroupingSeparators } from '@/lib/format/allocation-display';
import { formatRawTokenAmount } from '@/lib/format/number';
import type { SafeAccountConfig } from '@/lib/safe/config';
import { useCuratorSafeApps } from '@/lib/safe/safe-apps-context';
import { queueSafeTransfer } from '@/lib/safe/queue-transfer';
import { getConnectorProvider } from '@/lib/wallet/connector-provider';
import type { SafeTokenBalance } from '@/lib/safe/read-balances';
import { isNativeToken, SAFE_AMOUNT_DP } from '@/lib/safe/tokens';
import { cn } from '@/lib/utils';
import {
  EMPTY_ADDRESS_BOOK,
  listAddressBook,
  subscribeAddressBook,
  upsertAddressBookEntry,
} from '@/lib/safe/address-book';

const ZERO_ADDRESS = getAddress(zeroAddress);

type Step = 'form' | 'review';

function tokenKey(token: SafeTokenBalance): string {
  return String(token.address);
}

export function SafeSendDialog({
  account,
  balances,
  open,
  onOpenChange,
  initialToken,
}: {
  account: SafeAccountConfig;
  balances: ReadonlyArray<SafeTokenBalance>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialToken?: string;
}) {
  const { address: walletAddress, connector } = useAccount();
  const { sdk: safeAppSdk } = useCuratorSafeApps();
  const router = useRouter();
  const addressBook = useSyncExternalStore(
    subscribeAddressBook,
    listAddressBook,
    () => EMPTY_ADDRESS_BOOK
  );

  const sendable = useMemo(() => balances.filter((b) => b.balance > 0n), [balances]);
  const [selectedKey, setSelectedKey] = useState<string | null>(initialToken ?? null);
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [step, setStep] = useState<Step>('form');
  const [error, setError] = useState<unknown>(null);
  const [isQueueing, setIsQueueing] = useState(false);

  const selected =
    sendable.find((t) => tokenKey(t) === selectedKey) ?? sendable[0] ?? null;

  const recipientValid = isAddress(stripGroupingSeparators(recipient));
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

  const overBalance = selected != null && parsedAmount > selected.balance;
  const normalizedRecipient = recipientValid
    ? getAddress(stripGroupingSeparators(recipient))
    : null;
  const sendingToSelf =
    normalizedRecipient?.toLowerCase() === account.address.toLowerCase();
  // The zero address is not a burn convention — funds sent there are simply gone.
  const sendingToZero = normalizedRecipient === ZERO_ADDRESS;
  const canReview =
    selected != null &&
    recipientValid &&
    parsedAmount > 0n &&
    !overBalance &&
    !sendingToSelf &&
    !sendingToZero;

  async function handleQueue() {
    if (!selected || !normalizedRecipient) return;
    setIsQueueing(true);
    setError(null);
    try {
      await queueSafeTransfer({
        safeRole: account.role,
        safeLabel: account.label,
        token: selected.address,
        symbol: selected.symbol,
        decimals: selected.decimals,
        recipient: normalizedRecipient,
        amount: parsedAmount,
        balance: selected.balance,
        proposer: walletAddress,
        provider: await getConnectorProvider(connector),
        safeAppSdk,
      });
      upsertAddressBookEntry(normalizedRecipient, '');
      router.push(`/safe/${account.role}/transactions`);
    } catch (err) {
      setError(err ?? new Error('Failed to queue the transfer.'));
    } finally {
      setIsQueueing(false);
    }
  }

  if (step === 'review' && selected) {
    return (
      <SafeModal
        open={open}
        title="Review transfer"
        description={`From the ${account.label} Safe`}
        onOpenChange={onOpenChange}
        locked={isQueueing}
        footer={
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setStep('form')}
              disabled={isQueueing}
            >
              Back
            </Button>
            <Button className="flex-1" onClick={handleQueue} disabled={isQueueing}>
              {isQueueing ? 'Queueing…' : 'Queue proposal'}
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <div className="rounded-md border border-border p-3">
            <p className="text-xs text-muted-foreground">Amount</p>
            <p className="text-base font-semibold text-foreground">
              {formatRawTokenAmount(parsedAmount, selected.decimals, SAFE_AMOUNT_DP)} {selected.symbol}
            </p>
          </div>
          <div className="space-y-2 rounded-md border border-border p-3 text-xs">
            <div className="flex items-start justify-between gap-3">
              <span className="text-muted-foreground">From</span>
              <span className="break-all text-right font-mono text-foreground">
                {account.address}
              </span>
            </div>
            <div className="flex items-start justify-between gap-3">
              <span className="text-muted-foreground">To</span>
              <span className="break-all text-right font-mono text-foreground">
                {normalizedRecipient}
              </span>
            </div>
            <div className="flex items-start justify-between gap-3">
              <span className="text-muted-foreground">Safe balance after</span>
              <span className="text-right text-foreground">
                {formatRawTokenAmount(selected.balance - parsedAmount, selected.decimals, SAFE_AMOUNT_DP)}{' '}
                {selected.symbol}
              </span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Double-check the recipient. A Safe transfer cannot be reversed once executed.
          </p>
          {error != null ? <TxErrorBanner error={error} onDismiss={() => setError(null)} /> : null}
        </div>
      </SafeModal>
    );
  }

  return (
    <SafeModal
      open={open}
      title="Send from Safe"
      description={`${account.label} — queued for owner signatures`}
      onOpenChange={onOpenChange}
      footer={
        <Button className="w-full" onClick={() => setStep('review')} disabled={!canReview}>
          Review
          <ArrowRight className="ml-1 h-4 w-4" />
        </Button>
      }
    >
      <div className="space-y-4">
        {sendable.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            This Safe holds no assets with a non-zero balance.
          </p>
        ) : (
          <>
            <div className="space-y-1.5">
              <label htmlFor="safe-send-recipient" className="text-xs font-medium text-foreground">
                Recipient
              </label>
              <Input
                id="safe-send-recipient"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder="0x…"
                spellCheck={false}
                className="font-mono text-xs"
                list="safe-send-address-book"
              />
              <datalist id="safe-send-address-book">
                {addressBook.map((row) => (
                  <option key={row.address} value={row.address}>
                    {row.label}
                  </option>
                ))}
              </datalist>
              {recipient.length > 0 && !recipientValid ? (
                <p className="text-xs text-red-600 dark:text-red-400">
                  Not a valid address.
                </p>
              ) : null}
              {sendingToSelf ? (
                <p className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
                  <AlertTriangle className="h-3 w-3" />
                  That is this Safe&apos;s own address.
                </p>
              ) : null}
              {sendingToZero ? (
                <p className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
                  <AlertTriangle className="h-3 w-3" />
                  The zero address would destroy these funds.
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <span className="text-xs font-medium text-foreground">Asset</span>
              <div className="max-h-40 space-y-1 overflow-y-auto">
                {sendable.map((token) => {
                  const active = selected != null && tokenKey(token) === tokenKey(selected);
                  return (
                    <button
                      key={tokenKey(token)}
                      type="button"
                      onClick={() => {
                        setSelectedKey(tokenKey(token));
                        setAmount('');
                      }}
                      className={cn(
                        'flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left transition',
                        active
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30'
                          : 'border-border hover:bg-muted'
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-medium text-foreground">
                          {token.symbol}
                          {isNativeToken(token.address) ? (
                            <span className="ml-1 text-muted-foreground">(native)</span>
                          ) : null}
                        </span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {token.name}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {formatRawTokenAmount(token.balance, token.decimals, SAFE_AMOUNT_DP)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {selected ? (
              <AmountMaxInput
                id="safe-send-amount"
                label="Amount"
                symbol={selected.symbol}
                decimals={selected.decimals}
                value={amount}
                onChange={setAmount}
                maxRaw={selected.balance}
                availableCaption="Safe balance"
                hint={
                  isNativeToken(selected.address)
                    ? 'Leave enough ETH for the Safe to pay execution gas if it funds its own transactions.'
                    : undefined
                }
              />
            ) : null}

            {overBalance ? (
              <p className="text-xs text-red-600 dark:text-red-400">
                Amount exceeds the Safe balance.
              </p>
            ) : null}
          </>
        )}
      </div>
    </SafeModal>
  );
}
