import { coinbaseWallet } from '@wagmi/connectors/coinbaseWallet';

/**
 * AppKit adds its own Coinbase connector unless one already has id `coinbaseWallet`.
 * @wagmi/connectors names that connector `coinbaseWalletSDK`, so the check misses and
 * AppKit would register a second Coinbase connector. Renaming the id dedupes them.
 * (@coinbase/wallet-sdk 4.4 has no telemetry option and sends none.)
 */
export function coinbaseWalletForAppKit(parameters: {
  appName: string;
  appLogoUrl?: string;
}) {
  const create = coinbaseWallet({
    appName: parameters.appName,
    appLogoUrl: parameters.appLogoUrl,
    preference: { options: 'all' },
  });
  return ((config: Parameters<typeof create>[0]) => {
    const connector = create(config);
    return { ...connector, id: 'coinbaseWallet' };
  }) as typeof create;
}
