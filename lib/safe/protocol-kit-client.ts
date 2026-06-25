'use client';

import { getAddress, type Address, type Hex, type EIP1193Provider } from 'viem';
import { OperationType } from '@safe-global/types-kit';
import type Safe from '@safe-global/protocol-kit';
import { EthSafeSignature } from '@safe-global/protocol-kit';
import { BASE_CHAIN_ID } from '@/lib/constants';

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

function resolveRpcUrl(): string {
  const key = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY;
  if (key) return `https://base-mainnet.g.alchemy.com/v2/${key}`;
  return 'https://base-mainnet.g.alchemy.com/v2/demo';
}

function getInjectedEthereum(): EIP1193Provider | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { ethereum?: EIP1193Provider }).ethereum;
}

function resolveProvider(signer?: Address): string | EIP1193Provider {
  const ethereum = getInjectedEthereum();
  if (ethereum && signer) {
    return ethereum;
  }
  return resolveRpcUrl();
}

async function loadSafeKit(): Promise<typeof Safe> {
  const mod = await import('@safe-global/protocol-kit');
  return mod.default;
}

export async function initSafeProtocolKit(options: {
  safeAddress: Address;
  signer?: Address;
}): Promise<InstanceType<typeof Safe>> {
  const SafeKit = await loadSafeKit();
  return SafeKit.init({
    provider: resolveProvider(options.signer) as Parameters<typeof SafeKit.init>[0]['provider'],
    signer: options.signer,
    safeAddress: getAddress(options.safeAddress),
  });
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
  const protocolKit = await initSafeProtocolKit({ safeAddress: options.safeAddress });
  const safeTransaction = await protocolKit.createTransaction({
    transactions: [
      {
        to: getAddress(options.to),
        value: (options.value ?? 0n).toString(),
        data: options.data,
        operation: options.operation ?? OperationType.Call,
      },
    ],
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

export async function signSafeTransactionHash(options: {
  safeAddress: Address;
  signer: Address;
  safeTxHash: Hex;
}): Promise<Hex> {
  const protocolKit = await initSafeProtocolKit({
    safeAddress: options.safeAddress,
    signer: options.signer,
  });
  const signature = await protocolKit.signHash(options.safeTxHash);
  return signature.data as Hex;
}

export async function executeSafePendingTransaction(options: {
  safeAddress: Address;
  signer: Address;
  expectedSafeTxHash: Hex;
  transactionData: StoredSafeTransactionData;
  signatures: ReadonlyArray<{ signer: Address; data: Hex }>;
}): Promise<{ hash: Hex }> {
  const protocolKit = await initSafeProtocolKit({
    safeAddress: options.safeAddress,
    signer: options.signer,
  });

  const safeTransaction = await buildSafeTransaction(protocolKit, options.transactionData);

  const recomputedHash = (await protocolKit.getTransactionHash(safeTransaction)) as Hex;
  if (recomputedHash.toLowerCase() !== options.expectedSafeTxHash.toLowerCase()) {
    throw new Error(
      'Safe transaction hash mismatch — nonce may have changed or parameters drifted. Remove stale queue items and re-queue.'
    );
  }

  for (const sig of options.signatures) {
    safeTransaction.addSignature(new EthSafeSignature(getAddress(sig.signer), sig.data));
  }

  const response = await protocolKit.executeTransaction(safeTransaction);
  const hash = response.hash as Hex | undefined;
  if (!hash) {
    throw new Error('Safe execution did not return a transaction hash.');
  }
  return { hash };
}

export { BASE_CHAIN_ID };
