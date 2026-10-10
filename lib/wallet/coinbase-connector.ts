import { coinbaseWallet } from 'wagmi/connectors';

/**
 * AppKit adds its own Coinbase connector unless one already has id `coinbaseWallet`.
 * @wagmi/connectors names that connector `coinbaseWalletSDK`, so the check misses
 * and the default SDK still posts telemetry to as.coinbase.com.
 */
export function coinbaseWalletForAppKit(parameters: {
  appName: string;
  appLogoUrl?: string;
}) {
  const create = coinbaseWallet({
    appName: parameters.appName,
    appLogoUrl: parameters.appLogoUrl,
    preference: { options: 'all', telemetry: false },
  });
  return ((config: Parameters<typeof create>[0]) => {
    const connector = create(config);
    return { ...connector, id: 'coinbaseWallet' };
  }) as typeof create;
}
