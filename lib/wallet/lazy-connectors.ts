import type { CreateConnectorFn } from 'wagmi';
import { baseAccount } from '@wagmi/connectors/baseAccount';
import { coinbaseWallet } from '@wagmi/connectors/coinbaseWallet';

/**
 * Wallet connectors whose SDK stays asleep until the connector is used.
 *
 * A connector in the wagmi config is woken by the mount-time `reconnect()`, which calls
 * `getProvider()` on every connector. For Base Account and Coinbase Wallet that loads the
 * SDK and its cross-origin-opener `HEAD` request on every page load for every visitor.
 *
 * So until the user connects with it, or it was the last connector used and was not
 * disconnected, `getProvider()` returns nothing and `isAuthorized()` is false: reconnect
 * skips it. `disconnect()`, and a disconnect from the wallet side, are remembered (like the
 * injected connector's `shimDisconnect`), so a disconnected wallet does not come back on
 * reload. Connecting through the AppKit modal works as usual.
 */
export function lazyConnector<T extends CreateConnectorFn>(create: T, options: { id?: string; legacyIds?: readonly string[] } = {}): T {
  return ((config: Parameters<T>[0]) => {
    const connector = create(config) as ReturnType<CreateConnectorFn>;
    const id = options.id ?? connector.id;
    const disconnectedKey = `${id}.disconnected`;
    let awake = false;

    const shouldWake = async () => {
      if (awake) return true;
      try {
        const [recent, disconnected] = await Promise.all([
          config.storage?.getItem('recentConnectorId'),
          config.storage?.getItem(disconnectedKey as never),
        ]);
        return (recent === id || (options.legacyIds?.includes(recent as string) ?? false)) && !disconnected;
      } catch {
        return false;
      }
    };

    const remember = async (disconnected: boolean) => {
      try {
        if (disconnected) await config.storage?.setItem(disconnectedKey as never, true as never);
        else await config.storage?.removeItem(disconnectedKey as never);
      } catch {
        // Storage failure only means the connector may wake again on reload.
      }
    };

    // A disconnect from the wallet side (the provider's `disconnect` event) counts as a
    // disconnect too. The connector binds its own `onDisconnect` to the provider, so patch
    // the original object, not just the copy returned below.
    const onDisconnect = connector.onDisconnect.bind(connector);
    connector.onDisconnect = async (error?: Error) => {
      awake = false;
      await remember(true);
      return onDisconnect(error);
    };

    return {
      ...connector,
      id,
      async connect(args: Parameters<typeof connector.connect>[0]) {
        awake = true;
        await remember(false);
        return connector.connect(args);
      },
      async disconnect() {
        awake = false;
        await remember(true);
        try {
          await connector.disconnect();
        } catch {
          // The provider may not implement disconnect (e.g. an in-app injected provider).
          // wagmi still clears its connection state after this returns.
        }
      },
      async getProvider(args?: Parameters<typeof connector.getProvider>[0]) {
        if (!(await shouldWake())) return undefined;
        awake = true;
        return connector.getProvider(args);
      },
      async isAuthorized() {
        if (!(await shouldWake())) return false;
        return connector.isAuthorized();
      },
    };
  }) as T;
}

/**
 * Base Account (smart wallet). Registered by us so its SDK runs with `telemetry: false`
 * (AppKit's default leaves the SDK default, telemetry on); AppKit skips its own because a
 * `baseAccount` connector already exists.
 */
export function lazyBaseAccount(parameters: Parameters<typeof baseAccount>[0]) {
  return lazyConnector(baseAccount(parameters));
}

/**
 * Coinbase Wallet (app, extension and smart wallet via the SDK, 4.4: no telemetry). AppKit
 * adds its own Coinbase connector unless one has id `coinbaseWallet`; wagmi names this one
 * `coinbaseWalletSDK`, so the id is renamed to dedupe them and keep AppKit's (eager) one out.
 * It keeps the connector's `rdns` (`com.coinbase.wallet`), so wagmi does not add the
 * extension's EIP-6963 announcement as a second row: the SDK uses the extension when it
 * is installed, and keys.coinbase.com otherwise.
 */
export function lazyCoinbaseWallet(parameters: { appName: string; appLogoUrl?: string }) {
  return lazyConnector(
    coinbaseWallet({
      appName: parameters.appName,
      appLogoUrl: parameters.appLogoUrl,
      preference: { options: 'all' },
    }),
    // AppKit's own connector used the wagmi id `coinbaseWalletSDK`: wake for sessions
    // saved under it so they reconnect after the switch.
    { id: 'coinbaseWallet', legacyIds: ['coinbaseWalletSDK'] }
  );
}
