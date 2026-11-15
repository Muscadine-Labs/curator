import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  consumeRateLimit,
  rateLimitIdentifier,
  resolveClientIp,
} from '@/lib/utils/rate-limit';

function req(headers: Record<string, string>): Request {
  return new Request('https://curator.muscadine.xyz/api/auth/verify', { headers });
}

const ORIGINAL_HOPS = process.env.CURATOR_TRUSTED_PROXY_HOPS;
const ORIGINAL_VERCEL = process.env.VERCEL;

beforeEach(() => {
  delete process.env.CURATOR_TRUSTED_PROXY_HOPS;
  delete process.env.VERCEL;
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (ORIGINAL_HOPS === undefined) delete process.env.CURATOR_TRUSTED_PROXY_HOPS;
  else process.env.CURATOR_TRUSTED_PROXY_HOPS = ORIGINAL_HOPS;
  if (ORIGINAL_VERCEL === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = ORIGINAL_VERCEL;
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

describe('login rate-limit store', () => {
  it('counts in memory and denies past the limit', async () => {
    const id = `auth-verify:test-${Math.random()}`;
    expect(await consumeRateLimit(id, 2, 60_000)).toBe(true);
    expect(await consumeRateLimit(id, 2, 60_000)).toBe(true);
    expect(await consumeRateLimit(id, 2, 60_000)).toBe(false);
  });
});

describe('rateLimitIdentifier', () => {
  it('keys each endpoint path separately for the same client', () => {
    const a = new Request('https://x.test/api/vaults/0xAB/risk', { headers: { 'x-forwarded-for': '1.2.3.4' } });
    const b = new Request('https://x.test/api/vaults/0xab/governance', { headers: { 'x-forwarded-for': '1.2.3.4' } });
    expect(rateLimitIdentifier(a)).not.toBe(rateLimitIdentifier(b));
    // Different ids share the route's bucket.
    expect(rateLimitIdentifier(a)).toBe(
      rateLimitIdentifier(new Request('https://x.test/api/vaults/0xcd/risk', { headers: { 'x-forwarded-for': '1.2.3.4' } }))
    );
    expect(rateLimitIdentifier(a)).toBe(
      rateLimitIdentifier(new Request('https://x.test/api/vaults/0xab/risk?x=1', { headers: { 'x-forwarded-for': '1.2.3.4' } }))
    );
  });
});
