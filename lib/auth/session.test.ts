import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSessionToken } from '@/lib/auth/session';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('session HMAC secret', () => {
  it('refuses to HMAC with the login password in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CURATOR_SESSION_SECRET', '');
    vi.stubEnv('NEXT_PHASE', '');
    vi.stubEnv('CURATOR_ADMIN_PASSWORD', 'pw');
    await expect(createSessionToken()).rejects.toThrow('Auth not configured');
  });

  it('falls back to the login password in development', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('CURATOR_SESSION_SECRET', '');
    vi.stubEnv('CURATOR_ADMIN_PASSWORD', 'pw');
    await expect(createSessionToken()).resolves.toMatch(/\./);
  });
});
