import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSessionToken, readSessionRole } from '@/lib/auth/session';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('session HMAC secret', () => {
  it('uses CURATOR_ADMIN_PASSWORD in production when no dedicated session secret is set', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CURATOR_SESSION_SECRET', '');
    vi.stubEnv('NEXT_PHASE', '');
    vi.stubEnv('CURATOR_ADMIN_PASSWORD', 'pw');
    const token = await createSessionToken();
    expect(token).toMatch(/\./);
    await expect(readSessionRole(token)).resolves.toBe('admin');
  });

  it('prefers CURATOR_SESSION_SECRET when set', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CURATOR_SESSION_SECRET', 'dedicated-secret');
    vi.stubEnv('CURATOR_ADMIN_PASSWORD', 'pw');
    const token = await createSessionToken();
    expect(token).toMatch(/\./);
    await expect(readSessionRole(token)).resolves.toBe('admin');
  });

  it('falls back to the login password in development', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('CURATOR_SESSION_SECRET', '');
    vi.stubEnv('CURATOR_ADMIN_PASSWORD', 'pw');
    await expect(createSessionToken()).resolves.toMatch(/\./);
  });

  it('refuses to mint a session when no password or secret is set', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CURATOR_SESSION_SECRET', '');
    vi.stubEnv('CURATOR_ADMIN_PASSWORD', '');
    vi.stubEnv('CURATOR_OWNER_PASSWORD', '');
    await expect(createSessionToken()).rejects.toThrow('Auth not configured');
  });
});
