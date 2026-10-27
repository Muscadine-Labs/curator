import { NextResponse, type NextRequest } from 'next/server';
import {
  readSessionRole,
  tokenFromCookieHeader,
} from '@/lib/auth/session';

const PUBLIC_API = new Set([
  '/api/auth/verify',
  '/api/auth/me',
  '/api/auth/logout',
]);

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (!pathname.startsWith('/api/')) {
    return NextResponse.next();
  }
  if (PUBLIC_API.has(pathname)) {
    return NextResponse.next();
  }

  const role = await readSessionRole(
    tokenFromCookieHeader(request.headers.get('cookie'))
  );
  if (role === 'admin') {
    return NextResponse.next();
  }

  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

export const config = {
  matcher: ['/api/:path*'],
};
