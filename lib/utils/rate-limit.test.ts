import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  consumeRateLimit,
  hasSharedRateLimitStore,
  resolveClientIp,
} from '@/lib/utils/rate-limit';

function req(headers: Record<string, string>): Request {
  return new Request('https://curator.muscadine.xyz/api/auth/verify', { headers });
}

const ORIGINAL_HOPS = process.env.CURATOR_TRUSTED_PROXY_HOPS;
const ORIGINAL_VERCEL = process.env.VERCEL;
const ORIGINAL_UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const ORIGINAL_UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

beforeEach(() => {
  delete process.env.CURATOR_TRUSTED_PROXY_HOPS;
  delete process.env.VERCEL;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (ORIGINAL_HOPS === undefined) delete process.env.CURATOR_TRUSTED_PROXY_HOPS;
  else process.env.CURATOR_TRUSTED_PROXY_HOPS = ORIGINAL_HOPS;
  if (ORIGINAL_VERCEL === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = ORIGINAL_VERCEL;
  if (ORIGINAL_UPSTASH_URL === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
  else process.env.UPSTASH_REDIS_REST_URL = ORIGINAL_UPSTASH_URL;
  if (ORIGINAL_UPSTASH_TOKEN === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
  else process.env.UPSTASH_REDIS_REST_TOKEN = ORIGINAL_UPSTASH_TOKEN;
});

describe('resolveClientIp — trust rules', () => {
  it('never trusts x-forwarded-for without a configured hop count', () => {
    const { ip, trusted } = resolveClientIp(req({ 'x-forwarded-for': '1.2.3.4' }));
    expect(ip).toBe('1.2.3.4');
    expect(trusted).toBe(false);
  });

  it('never trusts a vendor header that any caller can send', () => {
    // Regression: trusting cf-connecting-ip whenever a hop count was set let an
    // attacker mint a fresh rate-limit bucket per request.
    process.env.CURATOR_TRUSTED_PROXY_HOPS = '1';
    expect(resolveClientIp(req({ 'cf-connecting-ip': '9.9.9.9' })).trusted).toBe(false);
    expect(resolveClientIp(req({ 'true-client-ip': '9.9.9.9' })).trusted).toBe(false);
    expect(resolveClientIp(req({ 'x-real-ip': '9.9.9.9' })).trusted).toBe(false);
  });

  it('does not trust x-vercel-forwarded-for when not running on Vercel', () => {
    expect(resolveClientIp(req({ 'x-vercel-forwarded-for': '9.9.9.9' })).trusted).toBe(false);
  });

  it('trusts x-vercel-forwarded-for on Vercel', () => {
    process.env.VERCEL = '1';
    const { ip, trusted } = resolveClientIp(req({ 'x-vercel-forwarded-for': '5.6.7.8' }));
    expect(ip).toBe('5.6.7.8');
    expect(trusted).toBe(true);
  });

  it('counts hops from the right so prepended entries cannot win', () => {
    process.env.CURATOR_TRUSTED_PROXY_HOPS = '1';
    // Attacker prepends junk; the real proxy appends the true client last.
    const { ip, trusted } = resolveClientIp(
      req({ 'x-forwarded-for': 'evil-1, evil-2, 203.0.113.7' })
    );
    expect(ip).toBe('203.0.113.7');
    expect(trusted).toBe(true);
  });

  it('picks the right hop with two proxies (Cloudflare + Vercel)', () => {
    process.env.CURATOR_TRUSTED_PROXY_HOPS = '2';
    const { ip, trusted } = resolveClientIp(
      req({ 'x-forwarded-for': 'spoofed, 203.0.113.7, 172.16.0.1' })
    );
    expect(ip).toBe('203.0.113.7');
    expect(trusted).toBe(true);
  });

  it('falls back to untrusted when the chain is shorter than the hop count', () => {
    process.env.CURATOR_TRUSTED_PROXY_HOPS = '3';
    expect(resolveClientIp(req({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2' })).trusted).toBe(false);
  });

  it('explicit hop config takes precedence over Vercel auto-detection', () => {
    process.env.VERCEL = '1';
    process.env.CURATOR_TRUSTED_PROXY_HOPS = '2';
    const { ip } = resolveClientIp(
      req({
        'x-forwarded-for': 'spoofed, 203.0.113.7, 172.16.0.1',
        'x-vercel-forwarded-for': '172.16.0.1',
      })
    );
    expect(ip).toBe('203.0.113.7');
  });

  it('ignores a non-numeric or non-positive hop count', () => {
    for (const value of ['abc', '0', '-1', '']) {
      process.env.CURATOR_TRUSTED_PROXY_HOPS = value;
      expect(resolveClientIp(req({ 'x-forwarded-for': '1.2.3.4' })).trusted).toBe(false);
    }
  });

  it('reports a stable identifier when no headers are present', () => {
    expect(resolveClientIp(req({}))).toEqual({ ip: 'unknown', trusted: false });
  });
});

describe('shared login rate-limit store', () => {
  it('stays in-memory when Upstash env is unset', () => {
    expect(hasSharedRateLimitStore()).toBe(false);
  });

  it('counts against Upstash when REST env is set', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'token';
    const replies = [1, -1, 'OK'];
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ result: replies.shift() }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    expect(hasSharedRateLimitStore()).toBe(true);
    expect(await consumeRateLimit('auth-verify:test', 10, 60_000)).toBe(true);
    expect(fetchMock).toHaveBeenCalled();
  });

  it('fails closed when Upstash is unreachable', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'token';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 500,
        json: async () => ({}),
      }))
    );
    expect(await consumeRateLimit('auth-verify:test', 10, 60_000)).toBe(false);
  });
});
