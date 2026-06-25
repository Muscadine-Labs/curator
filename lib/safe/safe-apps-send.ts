import type SafeAppsSDK from '@safe-global/safe-apps-sdk';
import { getAddress, type Address, type Hex } from 'viem';

/** Propose through the Safe App shell (Transaction Service under the hood). */
export async function sendTransactionViaSafeApp(
  sdk: SafeAppsSDK,
  tx: { to: Address; value?: string; data: Hex }
): Promise<Hex> {
  const response = await sdk.txs.send({
    txs: [
      {
        to: getAddress(tx.to),
        value: tx.value ?? '0',
        data: tx.data,
      },
    ],
  });
  return response.safeTxHash as Hex;
}
