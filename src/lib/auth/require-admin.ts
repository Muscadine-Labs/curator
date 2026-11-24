import { NextResponse } from 'next/server';
import { readSessionRole, tokenFromCookieHeader } from '@/lib/auth/session';

/**
 * Route-level session check. `proxy.ts` is an optimistic gate only
 * (Next.js does not treat the network proxy as an auth boundary).
 */
export async function unauthorizedUnlessAdmin(
  request: Request
): Promise<NextResponse | null> {
  const role = await readSessionRole(
    tokenFromCookieHeader(request.headers.get('cookie'))
  );
  if (role === 'admin') return null;
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
