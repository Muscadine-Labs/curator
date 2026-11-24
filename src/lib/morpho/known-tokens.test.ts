import { beforeEach, describe, expect, it, vi } from 'vitest';

const request = vi.fn();
const multicall = vi.fn();

vi.mock('@/lib/morpho/graphql-client', () => ({ morphoGraphQLClient: { request } }));
vi.mock('@/lib/onchain/client', () => ({ publicClient: { multicall } }));

const TOKEN_A = '0xaaaa000000000000000000000000000000000001';
const TOKEN_B = '0xbbbb000000000000000000000000000000000002';

async function load() {
  vi.resetModules();
  return import('@/lib/morpho/known-tokens');
}

describe('prefetchAssets', () => {
  beforeEach(() => {
    request.mockReset();
    multicall.mockReset();
  });

  it('fills metadata and prices for many tokens with one request', async () => {
    const { prefetchAssets, resolveTokenMeta, fetchAssetUsdPrice } = await load();
    request.mockResolvedValueOnce({
      assets: { items: [{ address: TOKEN_A, symbol: 'AAA', decimals: 6, price: { usd: 2 } }] },
    });
    await prefetchAssets([TOKEN_A, TOKEN_A.toUpperCase().replace('0X', '0x')], 8453, { prices: true });
    expect(request).toHaveBeenCalledTimes(1);
    expect((await resolveTokenMeta(TOKEN_A)).symbol).toBe('AAA');
    expect(await fetchAssetUsdPrice(TOKEN_A)).toBe(2);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('sends a token Morpho does not index straight to the chain', async () => {
    const { prefetchAssets, resolveTokenMeta } = await load();
    request.mockResolvedValueOnce({ assets: { items: [] } });
    multicall.mockResolvedValueOnce([
      { status: 'success', result: 8 },
      { status: 'success', result: 'BBB' },
    ]);
    await prefetchAssets([TOKEN_B]);
    const meta = await resolveTokenMeta(TOKEN_B);
    expect(meta).toMatchObject({ symbol: 'BBB', decimals: 8 });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('leaves per-token fallback in place when the batch fails', async () => {
    const { prefetchAssets, resolveTokenMeta } = await load();
    request.mockRejectedValueOnce(new Error('down'));
    await prefetchAssets([TOKEN_A]);
    request.mockResolvedValueOnce({
      assetByAddress: { address: TOKEN_A, symbol: 'AAA', decimals: 6 },
    });
    expect((await resolveTokenMeta(TOKEN_A)).symbol).toBe('AAA');
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('skips tokens it already knows', async () => {
    const { prefetchAssets } = await load();
    await prefetchAssets(['0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913']);
    expect(request).not.toHaveBeenCalled();
  });
});
