/** HttpOnly session cookie for curator BFF routes. Edge + Node (Web Crypto). */

export const CURATOR_SESSION_COOKIE = 'curator_session';
export const SESSION_MAX_AGE_SEC = 7 * 24 * 60 * 60;

function sessionVersion(): string {
  return process.env.CURATOR_SESSION_VERSION || '1';
}

function sessionSecret(): string {
  const dedicated = process.env.CURATOR_SESSION_SECRET?.trim();
  if (dedicated) return dedicated;
  // Dedicated HMAC secret is optional. Production login uses the same env
  // as local: CURATOR_ADMIN_PASSWORD (legacy CURATOR_OWNER_PASSWORD).
  return process.env.CURATOR_ADMIN_PASSWORD || process.env.CURATOR_OWNER_PASSWORD || '';
}

function bytesToB64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64UrlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacSha256(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return bytesToB64Url(new Uint8Array(sig));
}

export function passwordsMatch(provided: string, expected: string): boolean {
  const encoder = new TextEncoder();
  const a = encoder.encode(provided);
  const b = encoder.encode(expected);
  const len = Math.max(a.length, b.length, 32);
  const aPad = new Uint8Array(len);
  const bPad = new Uint8Array(len);
  aPad.set(a);
  bPad.set(b);
  let mismatch = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    mismatch |= aPad[i] ^ bPad[i];
  }
  return mismatch === 0;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export async function createSessionToken(): Promise<string> {
  const secret = sessionSecret();
  if (!secret) {
    throw new Error('Auth not configured');
  }
  const payload = JSON.stringify({
    role: 'admin',
    v: sessionVersion(),
    exp: Date.now() + SESSION_MAX_AGE_SEC * 1000,
  });
  const body = bytesToB64Url(new TextEncoder().encode(payload));
  const sig = await hmacSha256(secret, body);
  return `${body}.${sig}`;
}

export async function readSessionRole(token: string | undefined | null): Promise<'admin' | null> {
  if (!token) return null;
  const secret = sessionSecret();
  if (!secret) return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!body || !sig) return null;
  const expected = await hmacSha256(secret, body);
  if (!timingSafeEqual(expected, sig)) return null;
  try {
    const json = new TextDecoder().decode(b64UrlToBytes(body));
    const parsed = JSON.parse(json) as { role?: unknown; exp?: unknown; v?: unknown };
    if (parsed.role !== 'admin' || typeof parsed.exp !== 'number') return null;
    if (parsed.v !== sessionVersion()) return null;
    if (Date.now() > parsed.exp) return null;
    return 'admin';
  } catch {
    return null;
  }
}

function cookieSecureSuffix(): string {
  return process.env.NODE_ENV === 'production' ? '; Secure' : '';
}

export function sessionSetCookieHeader(token: string): string {
  return `${CURATOR_SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SEC}${cookieSecureSuffix()}`;
}

export function sessionClearCookieHeader(): string {
  return `${CURATOR_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${cookieSecureSuffix()}`;
}

export function tokenFromCookieHeader(cookieHeader: string | null): string | undefined {
  if (!cookieHeader) return undefined;
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${CURATOR_SESSION_COOKIE}=`)) {
      return trimmed.slice(CURATOR_SESSION_COOKIE.length + 1);
    }
  }
  return undefined;
}
