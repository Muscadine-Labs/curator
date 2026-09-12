/**
 * Rate limiting. Login uses a shared Upstash REST store when
 * UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN are set; otherwise an
 * in-memory map (per serverless isolate — not global).
 */

import { RATE_LIMIT_REQUESTS_PER_MINUTE, MINUTE_MS } from '@/lib/constants';

export { RATE_LIMIT_REQUESTS_PER_MINUTE, MINUTE_MS };

/** Cloudflare + Vercel is 2. Values above this fail closed (untrusted shared bucket). */
export const MAX_TRUSTED_PROXY_HOPS = 4;

interface RateLimitStore {
  [key: string]: {
    count: number;
    resetTime: number;
  };
}

const store: RateLimitStore = {};

/**
 * Simple rate limiter
 * @param identifier - Unique identifier for the rate limit (e.g., IP address, user ID)
 * @param maxRequests - Maximum number of requests allowed
 * @param windowMs - Time window in milliseconds
 * @returns true if request is allowed, false if rate limited
 */
function rateLimit(
  identifier: string,
  maxRequests: number,
  windowMs: number
): boolean {
  const now = Date.now();
  const key = identifier;

  // Clean up expired entries periodically
  // Use a more aggressive cleanup strategy: clean up every 100th request
  // This ensures memory doesn't grow unbounded while keeping performance good
  const cleanupThreshold = 100;
  const entryCount = Object.keys(store).length;
  if (entryCount > 0 && (entryCount % cleanupThreshold === 0 || Math.random() < 0.02)) {
    // Clean up expired entries
    Object.keys(store).forEach((k) => {
      if (store[k].resetTime < now) {
        delete store[k];
      }
    });
  }

  const entry = store[key];

  if (!entry || entry.resetTime < now) {
    // Create new entry or reset expired entry
    store[key] = {
      count: 1,
      resetTime: now + windowMs,
    };
    return true;
  }

  if (entry.count >= maxRequests) {
    return false; // Rate limited
  }

  entry.count++;
  return true;
}

function upstashConfig(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.replace(/\/$/, '');
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return { url, token };
}

export function hasSharedRateLimitStore(): boolean {
  return upstashConfig() !== null;
}

async function upstashCommand(command: (string | number)[]): Promise<unknown> {
  const cfg = upstashConfig();
  if (!cfg) throw new Error('Upstash is not configured');
  const res = await fetch(cfg.url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`Upstash ${res.status}`);
  }
  const json = (await res.json()) as { result?: unknown };
  return json.result;
}

function rateLimitKey(identifier: string): string {
  return `curator:rl:${identifier}`;
}

async function consumeUpstash(
  identifier: string,
  maxRequests: number,
  windowMs: number
): Promise<boolean> {
  const key = rateLimitKey(identifier);
  const count = Number(await upstashCommand(['INCR', key]));
  const ttlMs = Number(await upstashCommand(['PTTL', key]));
  if (!Number.isFinite(ttlMs) || ttlMs < 0) {
    await upstashCommand(['PEXPIRE', key, windowMs]);
  }
  return Number.isFinite(count) && count <= maxRequests;
}

async function peekUpstash(
  identifier: string,
  maxRequests: number
): Promise<{ allowed: boolean; remaining: number; resetTime: number | null }> {
  const key = rateLimitKey(identifier);
  const raw = await upstashCommand(['GET', key]);
  const ttlMs = Number(await upstashCommand(['PTTL', key]));
  const count = raw == null ? 0 : Number(raw);
  if (!Number.isFinite(count) || count <= 0 || !Number.isFinite(ttlMs) || ttlMs < 0) {
    return { allowed: true, remaining: maxRequests, resetTime: null };
  }
  return {
    allowed: count < maxRequests,
    remaining: Math.max(0, maxRequests - count),
    resetTime: Date.now() + ttlMs,
  };
}

/**
 * Record a hit against a bucket. Login must await this: with Upstash the
 * counter is shared across isolates; without it this is per-instance memory.
 * Upstash errors fail closed (deny) so a Redis outage is not a brute-force window.
 */
export async function consumeRateLimit(
  identifier: string,
  maxRequests: number,
  windowMs: number
): Promise<boolean> {
  if (upstashConfig()) {
    try {
      return await consumeUpstash(identifier, maxRequests, windowMs);
    } catch {
      return false;
    }
  }
  return rateLimit(identifier, maxRequests, windowMs);
}

/** Drop a bucket entirely, e.g. after a successful login. */
export async function resetRateLimit(identifier: string): Promise<void> {
  if (upstashConfig()) {
    try {
      await upstashCommand(['DEL', rateLimitKey(identifier)]);
    } catch {
      delete store[identifier];
    }
    return;
  }
  delete store[identifier];
}

/** Read a bucket without consuming from it. */
export async function peekRateLimit(
  identifier: string,
  maxRequests: number
): Promise<{ allowed: boolean; remaining: number; resetTime: number | null }> {
  if (upstashConfig()) {
    try {
      return await peekUpstash(identifier, maxRequests);
    } catch {
      return { allowed: false, remaining: 0, resetTime: Date.now() + 60_000 };
    }
  }
  const entry = store[identifier];
  if (!entry || entry.resetTime < Date.now()) {
    return { allowed: true, remaining: maxRequests, resetTime: null };
  }
  return {
    allowed: entry.count < maxRequests,
    remaining: Math.max(0, maxRequests - entry.count),
    resetTime: entry.resetTime,
  };
}

/**
 * Get rate limit info for an identifier
 * @param identifier - Unique identifier for the rate limit
 * @param maxRequests - Maximum number of requests allowed (used to calculate remaining)
 * @returns Rate limit info with remaining requests and reset time, or null if no active limit
 */
function getRateLimitInfo(
  identifier: string,
  maxRequests: number
): { remaining: number; resetTime: number } | null {
  const entry = store[identifier];
  if (!entry || entry.resetTime < Date.now()) {
    return null;
  }
  return {
    remaining: Math.max(0, maxRequests - entry.count),
    resetTime: entry.resetTime,
  };
}

function trustedProxyHops(): number {
  const raw = process.env.CURATOR_TRUSTED_PROXY_HOPS;
  if (!raw) return 0;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  // Inflated hop counts pick attacker-controlled left-hand XFF entries.
  if (parsed > MAX_TRUSTED_PROXY_HOPS) return 0;
  return parsed;
}

/**
 * Resolve the client IP and whether it can be trusted for security decisions.
 *
 * `x-forwarded-for` is appended to by every hop, so the client controls the
 * left-hand entries. Only the entry inserted by our own outermost proxy is
 * forgery-proof, and only if we know how many proxies sit in front of us —
 * hence `CURATOR_TRUSTED_PROXY_HOPS`. Callers that gate credentials must treat
 * `trusted: false` as "no usable per-client identity" rather than keying off a
 * value the caller picked.
 */
export function resolveClientIp(request: Request): { ip: string; trusted: boolean } {
  const chain =
    request.headers
      .get('x-forwarded-for')
      ?.split(',')
      .map((part) => part.trim())
      .filter(Boolean) ?? [];

  // Explicit operator config wins. Counting from the right is what makes this
  // forgery-proof: entries the caller prepends stay to the left of the ones our
  // own proxies append.
  const hops = trustedProxyHops();
  if (hops > 0 && chain.length >= hops) {
    return { ip: chain[chain.length - hops], trusted: true };
  }

  // Vercel overwrites `x-vercel-*` on inbound requests, so this cannot be
  // spoofed — but only when we are actually running on Vercel.
  const vercel = request.headers.get('x-vercel-forwarded-for')?.trim();
  if (vercel && process.env.VERCEL) {
    return { ip: vercel.split(',')[0].trim(), trusted: true };
  }

  // Deliberately no `cf-connecting-ip` branch: any caller can send that header,
  // and it is only meaningful if every request provably passed through
  // Cloudflare. Cloudflare appends the real client IP to `x-forwarded-for`
  // anyway, so the hop count above already covers that deployment.
  return { ip: chain[0] || request.headers.get('x-real-ip')?.trim() || 'unknown', trusted: false };
}

/**
 * Create a rate limit middleware for Next.js API routes.
 *
 * Best-effort abuse throttling only: an untrusted `x-forwarded-for` still keys
 * the bucket, because collapsing unattributable traffic into one shared bucket
 * here would let a single client lock out everyone else. Endpoints where a
 * bypass has a security cost (login) must key off `resolveClientIp().trusted`
 * themselves and pair it with a global cap.
 */
export function createRateLimitMiddleware(
  maxRequests: number,
  windowMs: number,
  bucket = 'api'
) {
  return (request: Request): { allowed: boolean; headers?: Headers } => {
    const identifier = `${bucket}:${resolveClientIp(request).ip}`;

    const allowed = rateLimit(identifier, maxRequests, windowMs);

    if (!allowed) {
      const info = getRateLimitInfo(identifier, maxRequests);
      const headers = new Headers();
      if (info) {
        headers.set('X-RateLimit-Limit', maxRequests.toString());
        headers.set('X-RateLimit-Remaining', '0');
        headers.set('X-RateLimit-Reset', Math.ceil(info.resetTime / 1000).toString());
      }
      return { allowed: false, headers };
    }

    const info = getRateLimitInfo(identifier, maxRequests);
    const headers = new Headers();
    if (info) {
      headers.set('X-RateLimit-Limit', maxRequests.toString());
      headers.set('X-RateLimit-Remaining', info.remaining.toString());
      headers.set('X-RateLimit-Reset', Math.ceil(info.resetTime / 1000).toString());
    }
    return { allowed: true, headers };
  };
}

