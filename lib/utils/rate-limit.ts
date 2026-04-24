/**
 * Simple in-memory rate limiting utility
 * For production, consider using @upstash/ratelimit or similar service
 */

import { RATE_LIMIT_REQUESTS_PER_MINUTE, MINUTE_MS } from '@/lib/constants';

export { RATE_LIMIT_REQUESTS_PER_MINUTE, MINUTE_MS };

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

/**
 * Create a rate limit middleware for Next.js API routes
 */
export function createRateLimitMiddleware(
  maxRequests: number,
  windowMs: number
) {
  return (request: Request): { allowed: boolean; headers?: Headers } => {
    // Try to get IP from various headers (for production, use a proper IP extraction)
    const forwarded = request.headers.get('x-forwarded-for');
    const realIp = request.headers.get('x-real-ip');
    const identifier = forwarded?.split(',')[0] || realIp || 'unknown';

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

