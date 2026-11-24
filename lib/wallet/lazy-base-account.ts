import { baseAccount } from '@wagmi/connectors/baseAccount';

type BaseAccountParameters = Parameters<typeof baseAccount>[0];

/**
 * Base Account connector that stays asleep until it is used.
 *
 * We register Base Account ourselves so its SDK runs with `telemetry: false` (AppKit's
 * default connector leaves the SDK default, telemetry on). But a connector in the wagmi
 * config is woken by the mount-time `reconnect()`, which calls `getProvider()` on every
 * connector: that would load the Base Account SDK and its cross-origin-opener HEAD request
 * on every page load for every visitor, and inside the Base App it could take over the
 * session from the injected wallet.
 *
 * So until the user connects with it, or it was the last connector used and was not
 * disconnected, `getProvider()` returns nothing and `isAuthorized()` is false: reconnect
 * skips it. `disconnect()` remembers the choice (like the injected connector's
 * `shimDisconnect`), so a disconnected Base Account does not come back on reload.
 */
export function lazyBaseAccount(parameters: BaseAccountParameters) {
  const create = baseAccount(parameters);
  return ((config: Parameters<typeof create>[0]) => {
    const connector = create(config);
    const disconnectedKey = `${connector.id}.disconnected` as const;
    let awake = false;

    const shouldWake = async () => {
      if (awake) return true;
      try {
        const [recent, disconnected] = await Promise.all([
          config.storage?.getItem('recentConnectorId'),
          config.storage?.getItem(disconnectedKey),
        ]);
        return recent === connector.id && !disconnected;
      } catch {
        return false;
      }
    };

    return {
      ...connector,
      async connect(args: Parameters<typeof connector.connect>[0]) {
        awake = true;
        await config.storage?.removeItem(disconnectedKey);
        return connector.connect(args);
      },
      async disconnect() {
        awake = false;
        await config.storage?.setItem(disconnectedKey, true);
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
  }) as typeof create;
}
