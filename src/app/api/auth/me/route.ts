import { NextRequest, NextResponse } from 'next/server';
import { readSessionRole, tokenFromCookieHeader } from '@/lib/auth/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const role = await readSessionRole(tokenFromCookieHeader(req.headers.get('cookie')));
  if (role !== 'admin') {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  return NextResponse.json({ ok: true, role: 'admin' });
}
