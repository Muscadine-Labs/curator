import type { EIP1193Provider } from 'viem';

/** AppKit/wagmi EIP-6963 provider — do not use `window.ethereum`. */
export async function getConnectorProvider(
  connector: { getProvider(): Promise<unknown> } | undefined
): Promise<EIP1193Provider | undefined> {
  if (!connector) return undefined;
  return (await connector.getProvider()) as EIP1193Provider | undefined;
}
