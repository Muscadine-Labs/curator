import { beforeEach, describe, expect, it, vi } from 'vitest';

const multicall = vi.fn();
vi.mock('@/lib/onchain/client', () => ({ publicClient: { multicall } }));

const TOKEN_A = '0xaaaa000000000000000000000000000000000001';
const TOKEN_B = '0xbbbb000000000000000000000000000000000002';

type Route = { status: number; body?: unknown };
let routes: Record<string, Route>;
const fetchMock = vi.fn(async (input: string) => {
  const path = new URL(input).pathname.toLowerCase();
  const route = routes[path] ?? { status: 404 };
  return new Response(JSON.stringify(route.body ?? {}), { status: route.status });
});

async function load() {
  vi.resetModules();
  vi.stubGlobal('fetch', fetchMock);
  return import('@/lib/morpho/known-tokens');
}

describe('known tokens (Morpho REST)', () => {
  beforeEach(() => {
    multicall.mockReset();
    fetchMock.mockClear();
    routes = {};
  });

  it('prefetch fills metadata and prices; later reads hit the cache', async () => {
    routes[`/v0/tokens/8453:${TOKEN_A}`] = { status: 200, body: { data: { address: TOKEN_A, symbol: 'AAA', decimals: 6 } } };
    routes[`/v0/tokens/8453:${TOKEN_A}/price`] = { status: 200, body: { data: { price: 2 } } };
    const { prefetchAssets, resolveTokenMeta, fetchAssetUsdPrice } = await load();
    await prefetchAssets([TOKEN_A, TOKEN_A.toUpperCase().replace('0X', '0x')], 8453, { prices: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((await resolveTokenMeta(TOKEN_A)).symbol).toBe('AAA');
    expect(await fetchAssetUsdPrice(TOKEN_A)).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('sends a token Morpho does not index (404) straight to the chain', async () => {
    multicall.mockResolvedValueOnce([
      { status: 'success', result: 8 },
      { status: 'success', result: 'BBB' },
    ]);
    const { prefetchAssets, resolveTokenMeta } = await load();
    await prefetchAssets([TOKEN_B]);
    const meta = await resolveTokenMeta(TOKEN_B);
    expect(meta).toMatchObject({ symbol: 'BBB', decimals: 8 });
    // One REST miss, then the chain; the second resolve is cached.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a REST outage falls back to the chain without caching a miss', async () => {
    routes[`/v0/tokens/8453:${TOKEN_A}`] = { status: 500 };
    multicall.mockResolvedValue([
      { status: 'success', result: 6 },
      { status: 'success', result: 'AAA' },
    ]);
    const { resolveTokenMeta } = await load();
    expect((await resolveTokenMeta(TOKEN_A)).decimals).toBe(6);
  });

  it('skips tokens it already knows', async () => {
    const { prefetchAssets } = await load();
    await prefetchAssets(['0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913']);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
