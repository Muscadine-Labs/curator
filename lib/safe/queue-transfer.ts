'use client';

import { getAddress, type Address, type EIP1193Provider } from 'viem';
import type SafeAppsSDK from '@safe-global/safe-apps-sdk';
import type { TxPreview } from '@/lib/morpho/tx-preview';
import { formatRawTokenAmount } from '@/lib/format/number';
import type { SafeRole } from '@/lib/safe/config';
import { buildSafeTransferCalldata } from '@/lib/safe/build-transfer-calldata';
import { queueSafeTransaction } from '@/lib/safe/queue-vault-write';
import { isNativeToken, SAFE_AMOUNT_DP, type SafeTokenAddress } from '@/lib/safe/tokens';
import type { SafePendingTransaction } from '@/lib/safe/types';

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function buildTransferPreview(options: {
  safeLabel: string;
  recipient: Address;
  amount: bigint;
  symbol: string;
  decimals: number;
  balance: bigint;
}): TxPreview {
  const amount = `${formatRawTokenAmount(options.amount, options.decimals, SAFE_AMOUNT_DP)} ${options.symbol}`;
  return {
    title: `Send ${amount}`,
    description: `From the ${options.safeLabel} Safe to ${shortAddress(options.recipient)}`,
    changes: [
      {
        action: 'withdraw',
        label: options.symbol,
        subtitle: `To ${shortAddress(options.recipient)}`,
        before: `${formatRawTokenAmount(options.balance, options.decimals, SAFE_AMOUNT_DP)} ${options.symbol}`,
        after: `${formatRawTokenAmount(options.balance - options.amount, options.decimals, SAFE_AMOUNT_DP)} ${options.symbol}`,
        delta: `−${amount}`,
      },
    ],
    footnote:
      'Queued as a Safe proposal. It moves nothing until enough owners sign and it is executed.',
  };
}

export async function queueSafeTransfer(options: {
  safeRole: SafeRole;
  safeLabel: string;
  token: SafeTokenAddress;
  symbol: string;
  decimals: number;
  recipient: Address;
  amount: bigint;
  balance: bigint;
  proposer?: Address;
  provider?: EIP1193Provider;
  safeAppSdk?: SafeAppsSDK | null;
}): Promise<SafePendingTransaction> {
  if (options.amount > options.balance) {
    throw new Error(`Amount exceeds the Safe's ${options.symbol} balance.`);
  }

  const calldata = buildSafeTransferCalldata({
    token: options.token,
    recipient: options.recipient,
    amount: options.amount,
  });

  return queueSafeTransaction({
    safeRole: options.safeRole,
    calldata,
    description: `Send ${formatRawTokenAmount(options.amount, options.decimals, SAFE_AMOUNT_DP)} ${options.symbol} to ${shortAddress(options.recipient)}`,
    preview: buildTransferPreview(options),
    source: {
      type: 'transfer',
      token: isNativeToken(options.token) ? 'native' : getAddress(options.token),
      tokenSymbol: options.symbol,
      recipient: getAddress(options.recipient),
      amount: options.amount.toString(),
    },
    proposer: options.proposer,
    provider: options.provider,
    safeAppSdk: options.safeAppSdk,
  });
}
