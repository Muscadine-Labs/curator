import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls: string[] = [];
const provider = { request: vi.fn() };

vi.mock('@wagmi/connectors/baseAccount', () => ({
  baseAccount: () => () => ({
    id: 'baseAccount',
    name: 'Base Account',
    type: 'baseAccount',
    async connect() {
      calls.push('connect');
      return { accounts: ['0x0000000000000000000000000000000000000001'], chainId: 8453 };
    },
    async disconnect() {
      calls.push('disconnect');
      throw new Error('provider.disconnect is not a function');
    },
    async getProvider() {
      calls.push('getProvider');
      return provider;
    },
    async isAuthorized() {
      calls.push('isAuthorized');
      return true;
    },
  }),
}));

import { lazyBaseAccount } from '@/lib/wallet/lazy-base-account';

function setup(initial: Record<string, unknown> = {}) {
  const store = new Map<string, unknown>(Object.entries(initial));
  const storage = {
    getItem: async (key: string) => store.get(key) ?? null,
    setItem: async (key: string, value: unknown) => void store.set(key, value),
    removeItem: async (key: string) => void store.delete(key),
  };
  const factory = lazyBaseAccount({ appName: 'Test' });
  const connector = factory({ storage } as unknown as Parameters<typeof factory>[0]);
  return { connector, store };
}

beforeEach(() => {
  calls.length = 0;
});

describe('lazyBaseAccount', () => {
  it('stays asleep during reconnect when another connector was used last', async () => {
    const { connector } = setup({ recentConnectorId: 'injected' });
    expect(await connector.getProvider()).toBeUndefined();
    expect(await connector.isAuthorized()).toBe(false);
    expect(calls).toEqual([]);
  });

  it('stays asleep for a first-time visitor', async () => {
    const { connector } = setup();
    expect(await connector.getProvider()).toBeUndefined();
    expect(calls).toEqual([]);
  });

  it('wakes for reconnect when Base Account was used last', async () => {
    const { connector } = setup({ recentConnectorId: 'baseAccount' });
    expect(await connector.getProvider()).toBe(provider);
    expect(await connector.isAuthorized()).toBe(true);
  });

  it('wakes once the user connects with it', async () => {
    const { connector } = setup({ recentConnectorId: 'injected' });
    await connector.connect({});
    expect(await connector.getProvider()).toBe(provider);
  });

  it('remembers a disconnect, tolerates a provider without disconnect, and clears it on connect', async () => {
    const { connector, store } = setup({ recentConnectorId: 'baseAccount' });
    await expect(connector.disconnect()).resolves.toBeUndefined();
    expect(store.get('baseAccount.disconnected')).toBe(true);
    expect(await connector.isAuthorized()).toBe(false);
    await connector.connect({});
    expect(store.has('baseAccount.disconnected')).toBe(false);
    expect(await connector.isAuthorized()).toBe(true);
  });
});
