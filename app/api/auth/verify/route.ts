import { NextRequest, NextResponse } from 'next/server';

// Prefer CURATOR_ADMIN_PASSWORD; fall back to legacy CURATOR_OWNER_PASSWORD
// so existing deployments keep working until env vars are rotated.
const ADMIN_PASSWORD = process.env.CURATOR_ADMIN_PASSWORD || process.env.CURATOR_OWNER_PASSWORD;

/**
 * POST /api/auth/verify
 * Body: { username: string, password: string }
 * Returns 200 { ok: true, role: 'admin' } if credentials match, else 401.
 * The only valid username is "admin" (case-sensitive).
 */
export async function POST(req: NextRequest) {
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

  if (username === 'admin' && password === ADMIN_PASSWORD) {
    return NextResponse.json({ ok: true, role: 'admin' });
  }

  return NextResponse.json({ error: 'Invalid username or password' }, { status: 401 });
}
