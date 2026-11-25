import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearMorphoRestCache, morphoRestGet, morphoRestList, MorphoRestError } from '@/lib/morpho/rest-client';
import { managementFeePerYear, marketSupplyApy } from '@/lib/morpho/rest-data';

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const rateLimited = (retryAfter: string) =>
  new Response('{}', { status: 429, headers: { 'retry-after': retryAfter } });

describe('morphoRestGet cache and retries', () => {
  beforeEach(() => {
    clearMorphoRestCache();
    vi.useFakeTimers({ toFake: ['Date'] });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('reuses a response for 60s, then serves it again when Morpho rate-limits', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(ok({ data: { v: 1 } })).mockResolvedValue(rateLimited('600'));
    vi.stubGlobal('fetch', fetchMock);
    expect(await morphoRestGet('/v0/x')).toEqual({ v: 1 });
    expect(await morphoRestGet('/v0/x')).toEqual({ v: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 5 * 60_000);
    expect(await morphoRestGet('/v0/x')).toEqual({ v: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives up at once on a long Retry-After instead of sleeping', async () => {
    const fetchMock = vi.fn().mockResolvedValue(rateLimited('600'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(morphoRestGet('/v0/y', undefined, { revalidate: 0 })).rejects.toMatchObject({
      status: 429,
      rateLimited: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never caches per-wallet reads', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(ok({ data: 1 })).mockResolvedValueOnce(ok({ data: 2 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await morphoRestGet('/v0/z', undefined, { revalidate: 0 })).toBe(1);
    expect(await morphoRestGet('/v0/z', undefined, { revalidate: 0 })).toBe(2);
  });

  it('a 404 is a MorphoRestError with status 404', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 404 })));
    const error = await morphoRestGet('/v0/missing').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MorphoRestError);
    expect((error as MorphoRestError).status).toBe(404);
  });

  it('pages a list until the cursor is null', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok({ data: [1, 2], cursor: 'c1' }))
      .mockResolvedValueOnce(ok({ data: [3], cursor: null }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await morphoRestList('/v0/list', {}, { revalidate: 0 })).toEqual([1, 2, 3]);
    expect(String(fetchMock.mock.calls[1]![0])).toContain('cursor=c1');
  });
});

describe('marketSupplyApy (Adaptive Curve IRM)', () => {
  const irm = { irm_address: '0x46415998764C29aB2a25CbeA6254146D50D22687' };
  // 4% a year at target, as a per-second WAD rate.
  const rateAtTarget = String(Math.round((Math.log(1.04) / 31_536_000) * 1e18));

  it('at 90% utilization: borrow APY is the rate at target, supply APY × utilization', () => {
    const apy = marketSupplyApy(
      irm,
      { total_supply_assets: '1000', total_borrow_assets: '900', fee_wad: '0', rate_at_target_per_second_wad: rateAtTarget, last_accrual_timestamp: 100 });
    expect(apy).toBeCloseTo(0.04 * 0.9, 6);
  });

  it('applies the market fee and returns null for another IRM', () => {
    const state = { total_supply_assets: '1000', total_borrow_assets: '900', fee_wad: '100000000000000000', rate_at_target_per_second_wad: rateAtTarget, last_accrual_timestamp: 100 };
    expect(marketSupplyApy(irm, state)).toBeCloseTo(0.04 * 0.9 * 0.9, 6);
    expect(marketSupplyApy({ irm_address: '0xother' }, state)).toBeNull();
  });

  it('is 0 with nothing borrowed', () => {
    expect(
      marketSupplyApy(irm, { total_supply_assets: '1000', total_borrow_assets: '0', fee_wad: '0', rate_at_target_per_second_wad: rateAtTarget, last_accrual_timestamp: 0 })
    ).toBe(0);
  });
});

describe('managementFeePerYear', () => {
  it('turns a per-second WAD into a yearly fraction', () => {
    expect(managementFeePerYear(String(Math.round((0.02 / 31_536_000) * 1e18)))).toBeCloseTo(0.02, 9);
    expect(managementFeePerYear(null)).toBe(0);
  });
});
