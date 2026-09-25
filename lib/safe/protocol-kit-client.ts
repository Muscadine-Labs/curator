'use client';

import { getAddress, type Address, type Hex, type EIP1193Provider } from 'viem';
import { OperationType } from '@safe-global/types-kit';
import type Safe from '@safe-global/protocol-kit';
import { EthSafeSignature } from '@safe-global/protocol-kit';
import { BASE_CHAIN_ID } from '@/lib/constants';
import { getSafePendingSnapshot } from '@/lib/safe/pending-store';
import {
  fetchPendingMultisigTransactions,
  isTransactionServiceConfigured,
} from '@/lib/safe/transaction-service';

export type StoredSafeTransactionData = {
  to: Address;
  value: string;
  data: Hex;
  operation: 0 | 1;
  safeTxGas: string;
  baseGas: string;
  gasPrice: string;
  gasToken: Address;
  refundReceiver: Address;
  nonce: string;
};

/** Pick the fields that define a Safe tx (and its `safeTxHash`) off a stored proposal. */
export function storedSafeTransactionData(
  tx: StoredSafeTransactionData
): StoredSafeTransactionData {
  return {
    to: tx.to,
    value: tx.value,
    data: tx.data,
    operation: tx.operation,
    safeTxGas: tx.safeTxGas,
    baseGas: tx.baseGas,
    gasPrice: tx.gasPrice,
    gasToken: tx.gasToken,
    refundReceiver: tx.refundReceiver,
    nonce: tx.nonce,
  };
}

function resolveRpcUrl(): string {
  const key = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY?.trim();
  if (key) return `https://base-mainnet.g.alchemy.com/v2/${key}`;
  return 'https://mainnet.base.org';
}

function resolveProvider(
  signer?: Address,
  injected?: EIP1193Provider
): string | EIP1193Provider {
  if (!signer) return resolveRpcUrl();
  if (!injected) {
    throw new Error(
      'Connect a wallet to sign. Signing uses the wagmi connector provider, not window.ethereum.'
    );
  }
  return injected;
}

async function loadSafeKit(): Promise<typeof Safe> {
  const mod = await import('@safe-global/protocol-kit');
  return mod.default;
}

/**
 * Read-only kits are cached per Safe: they are built against the fixed Base RPC
 * URL, so there is nothing about them that can go stale within a session.
 *
 * Signer-bound kits are deliberately **not** cached. Those run on the injected
 * wallet provider and capture its chain id at init, so a cached one would keep
 * signing against whatever network the wallet happened to be on when it was
 * first built — producing a `safeTxHash` for the wrong chain after the user
 * switches networks.
 */
const readOnlyKitCache = new Map<Address, Promise<InstanceType<typeof Safe>>>();

export async function initSafeProtocolKit(options: {
  safeAddress: Address;
  signer?: Address;
  provider?: EIP1193Provider;
}): Promise<InstanceType<typeof Safe>> {
  const safeAddress = getAddress(options.safeAddress);

  const build = () =>
    loadSafeKit().then((SafeKit) =>
      SafeKit.init({
        provider: resolveProvider(options.signer, options.provider) as Parameters<
          typeof SafeKit.init
        >[0]['provider'],
        signer: options.signer,
        safeAddress,
      })
    );

  if (options.signer) return build();

  const cached = readOnlyKitCache.get(safeAddress);
  if (cached) return cached;

  const pending = build();
  readOnlyKitCache.set(safeAddress, pending);
  // A failed init must not stay cached, or every later call replays the error.
  pending.catch(() => readOnlyKitCache.delete(safeAddress));
  return pending;
}

function storedDataToCreateOptions(data: StoredSafeTransactionData) {
  return {
    nonce: Number(data.nonce),
    safeTxGas: data.safeTxGas,
    baseGas: data.baseGas,
    gasPrice: data.gasPrice,
    gasToken: data.gasToken,
    refundReceiver: data.refundReceiver,
  };
}

async function buildSafeTransaction(
  protocolKit: InstanceType<typeof Safe>,
  data: StoredSafeTransactionData
) {
  return protocolKit.createTransaction({
    transactions: [
      {
        to: data.to,
        value: data.value,
        data: data.data,
        operation: data.operation,
      },
    ],
    options: storedDataToCreateOptions(data),
  });
}

export async function resolveNextSafeNonce(safeAddress: Address): Promise<number> {
  const protocolKit = await initSafeProtocolKit({ safeAddress });
  const onChain = Number(await protocolKit.getNonce());
  const pending = getSafePendingSnapshot().filter((tx) => {
    if (tx.safeAddress.toLowerCase() !== safeAddress.toLowerCase()) return false;
    return tx.status === 'awaiting_signatures' || tx.status === 'ready';
  });
  let highest = onChain - 1;
  for (const tx of pending) {
    const n = Number(tx.nonce);
    if (Number.isFinite(n)) highest = Math.max(highest, n);
  }
  if (isTransactionServiceConfigured()) {
    try {
      const serviceTxs = await fetchPendingMultisigTransactions(safeAddress);
      for (const tx of serviceTxs) {
        const n = Number(tx.nonce);
        if (Number.isFinite(n)) highest = Math.max(highest, n);
      }
    } catch {
      // Local + on-chain nonce still used if the service is unreachable.
    }
  }
  return Math.max(onChain, highest + 1);
}

export async function createSafeTransactionFromCalldata(options: {
  safeAddress: Address;
  to: Address;
  data: Hex;
  value?: bigint;
  operation?: OperationType;
}): Promise<{
  safeTxHash: Hex;
  transactionData: StoredSafeTransactionData;
}> {
  return createSafeTransactionFromCalls({
    safeAddress: options.safeAddress,
    calls: [
      {
        to: options.to,
        data: options.data,
        value: options.value,
        operation: options.operation,
      },
    ],
  });
}

export async function createSafeTransactionFromCalls(options: {
  safeAddress: Address;
  calls: ReadonlyArray<{
    to: Address;
    data: Hex;
    value?: bigint;
    operation?: OperationType;
  }>;
  nonce?: number;
}): Promise<{
  safeTxHash: Hex;
  transactionData: StoredSafeTransactionData;
}> {
  const protocolKit = await initSafeProtocolKit({ safeAddress: options.safeAddress });
  const nonce = options.nonce ?? (await resolveNextSafeNonce(options.safeAddress));
  const safeTransaction = await protocolKit.createTransaction({
    transactions: options.calls.map((call) => ({
      to: getAddress(call.to),
      value: (call.value ?? 0n).toString(),
      data: call.data,
      operation: call.operation ?? OperationType.Call,
    })),
    options: { nonce },
  });

  const safeTxHash = (await protocolKit.getTransactionHash(safeTransaction)) as Hex;
  const txData = safeTransaction.data;

  return {
    safeTxHash,
    transactionData: {
      to: getAddress(txData.to),
      value: txData.value,
      data: txData.data as Hex,
      operation: txData.operation as 0 | 1,
      safeTxGas: txData.safeTxGas,
      baseGas: txData.baseGas,
      gasPrice: txData.gasPrice,
      gasToken: getAddress(txData.gasToken),
      refundReceiver: getAddress(txData.refundReceiver),
      nonce: String(txData.nonce),
    },
  };
}

/**
 * Rebuild the Safe tx from its stored fields and confirm it hashes to the
 * `safeTxHash` we are about to sign or execute. Proposals imported from the
 * Transaction Service carry the service's hash next to separate `to`/`data`
 * fields; the owner reads a preview decoded from `data`, so signing the stored
 * hash without this check could approve a different transaction.
 */
async function buildVerifiedSafeTransaction(
  protocolKit: InstanceType<typeof Safe>,
  transactionData: StoredSafeTransactionData,
  expectedSafeTxHash: Hex
) {
  const safeTransaction = await buildSafeTransaction(protocolKit, transactionData);
  const recomputedHash = (await protocolKit.getTransactionHash(safeTransaction)) as Hex;
  if (recomputedHash.toLowerCase() !== expectedSafeTxHash.toLowerCase()) {
    throw new Error(
      'Safe transaction hash mismatch — nonce may have changed or parameters drifted. Remove stale queue items and re-queue.'
    );
  }
  return { safeTransaction, safeTxHash: recomputedHash };
}

export async function signSafeTransactionHash(options: {
  safeAddress: Address;
  signer: Address;
  safeTxHash: Hex;
  transactionData: StoredSafeTransactionData;
  provider?: EIP1193Provider;
}): Promise<Hex> {
  const protocolKit = await initSafeProtocolKit({
    safeAddress: options.safeAddress,
    signer: options.signer,
    provider: options.provider,
  });
  const { safeTxHash } = await buildVerifiedSafeTransaction(
    protocolKit,
    options.transactionData,
    options.safeTxHash
  );
  const signature = await protocolKit.signHash(safeTxHash);
  return signature.data as Hex;
}

/**
 * Encode `execTransaction` for the connected wallet to send.
 *
 * The outer call always carries `value: 0`. `execTransaction` is payable, so
 * forwarding the inner Safe tx's `value` would make the executor fund the
 * transfer out of their own wallet instead of the Safe's balance. Mirrors
 * protocol-kit's `executeTransaction` pre-checks (threshold, Safe ETH balance).
 */
export async function executeSafePendingTransaction(options: {
  safeAddress: Address;
  signer: Address;
  expectedSafeTxHash: Hex;
  transactionData: StoredSafeTransactionData;
  signatures: ReadonlyArray<{ signer: Address; data: Hex }>;
  provider?: EIP1193Provider;
}): Promise<{ to: Address; data: Hex; value: bigint }> {
  const protocolKit = await initSafeProtocolKit({
    safeAddress: options.safeAddress,
    signer: options.signer,
    provider: options.provider,
  });

  const { safeTransaction } = await buildVerifiedSafeTransaction(
    protocolKit,
    options.transactionData,
    options.expectedSafeTxHash
  );

  for (const sig of options.signatures) {
    safeTransaction.addSignature(new EthSafeSignature(getAddress(sig.signer), sig.data));
  }

  const threshold = await protocolKit.getThreshold();
  if (safeTransaction.signatures.size < threshold) {
    throw new Error(
      `Need ${threshold} signature(s); have ${safeTransaction.signatures.size}.`
    );
  }

  const innerValue = BigInt(options.transactionData.value || '0');
  if (innerValue > 0n) {
    const balance = await protocolKit.getBalance();
    if (innerValue > balance) {
      throw new Error('The Safe does not hold enough ETH for this transfer.');
    }
  }

  const data = (await protocolKit.getEncodedTransaction(safeTransaction)) as Hex;
  return {
    to: getAddress(options.safeAddress),
    data,
    value: 0n,
  };
}

export { BASE_CHAIN_ID };
