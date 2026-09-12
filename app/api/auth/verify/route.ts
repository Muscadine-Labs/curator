import { NextRequest, NextResponse } from 'next/server';
import { createSessionToken, passwordsMatch, sessionSetCookieHeader } from '@/lib/auth/session';
import {
  consumeRateLimit,
  peekRateLimit,
  resetRateLimit,
  resolveClientIp,
} from '@/lib/utils/rate-limit';
import {
  AUTH_LOGIN_GLOBAL_MAX_ATTEMPTS,
  AUTH_LOGIN_GLOBAL_WINDOW_MS,
  AUTH_LOGIN_MAX_ATTEMPTS,
  AUTH_LOGIN_WINDOW_MS,
} from '@/lib/constants';

const ADMIN_PASSWORD = process.env.CURATOR_ADMIN_PASSWORD || process.env.CURATOR_OWNER_PASSWORD;

const GLOBAL_BUCKET = 'auth-verify:global';

function tooManyAttempts(resetTime: number | null) {
  const headers = new Headers();
  headers.set('X-RateLimit-Limit', AUTH_LOGIN_MAX_ATTEMPTS.toString());
  headers.set('X-RateLimit-Remaining', '0');
  if (resetTime) {
    headers.set('X-RateLimit-Reset', Math.ceil(resetTime / 1000).toString());
    headers.set('Retry-After', Math.max(1, Math.ceil((resetTime - Date.now()) / 1000)).toString());
  }
  return NextResponse.json(
    { error: 'Too many login attempts. Try again later.' },
    { status: 429, headers }
  );
}

/**
 * POST /api/auth/verify
 * Body: { username: string, password: string }
 * Returns 200 { ok: true, role: 'admin' } if credentials match, else 401.
 * Sets an HttpOnly session cookie. The only valid username is "admin".
 */
export async function POST(req: NextRequest) {
  const { ip, trusted } = resolveClientIp(req);
  const clientBucket = `auth-verify:${trusted ? ip : 'untrusted'}`;

  // Claim the attempt up front. `consumeRateLimit` checks and increments in one
  // synchronous step; peeking here and consuming after `await req.json()` would
  // let concurrent requests all pass the check before any of them counted.
  // A successful login clears both buckets below, so charging every attempt
  // costs a legitimate admin nothing.
  if (!(await consumeRateLimit(clientBucket, AUTH_LOGIN_MAX_ATTEMPTS, AUTH_LOGIN_WINDOW_MS))) {
    return tooManyAttempts(
      (await peekRateLimit(clientBucket, AUTH_LOGIN_MAX_ATTEMPTS)).resetTime
    );
  }
  if (
    !(await consumeRateLimit(
      GLOBAL_BUCKET,
      AUTH_LOGIN_GLOBAL_MAX_ATTEMPTS,
      AUTH_LOGIN_GLOBAL_WINDOW_MS
    ))
  ) {
    return tooManyAttempts(
      (await peekRateLimit(GLOBAL_BUCKET, AUTH_LOGIN_GLOBAL_MAX_ATTEMPTS)).resetTime
    );
  }

  if (!ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Auth not configured' }, { status: 503 });
  }
  let body: { username?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const username = typeof body?.username === 'string' ? body.username.trim() : '';
  const password = typeof body?.password === 'string' ? body.password : '';

  if (username === 'admin' && passwordsMatch(password, ADMIN_PASSWORD)) {
    try {
      const token = await createSessionToken();
      const res = NextResponse.json({ ok: true, role: 'admin' });
      res.headers.append('Set-Cookie', sessionSetCookieHeader(token));
      await resetRateLimit(clientBucket);
      await resetRateLimit(GLOBAL_BUCKET);
      return res;
    } catch {
      return NextResponse.json({ error: 'Auth not configured' }, { status: 503 });
    }
  }

  return NextResponse.json({ error: 'Invalid username or password' }, { status: 401 });
}
