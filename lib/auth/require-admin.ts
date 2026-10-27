import { NextResponse } from 'next/server';
import { anonymousMayRead } from '@/lib/auth/public-read';
import { readSessionRole, tokenFromCookieHeader } from '@/lib/auth/session';

/**
 * Route-level session check. `proxy.ts` is an optimistic gate only
 * (Next.js does not treat the network proxy as an auth boundary).
 * Anonymous GET is allowed for Overview, Vaults, and Markets reads.
 * Testing vaults and every write stay admin-only.
 */
export async function unauthorizedUnlessAdmin(
  request: Request
): Promise<NextResponse | null> {
  const role = await readSessionRole(
    tokenFromCookieHeader(request.headers.get('cookie'))
  );
  if (role === 'admin') return null;
  const pathname = new URL(request.url).pathname;
  if (anonymousMayRead(request.method, pathname)) return null;
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
