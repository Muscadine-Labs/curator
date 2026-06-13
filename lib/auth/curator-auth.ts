/**
 * Curator/Business auth: username + password verification and cached session with role.
 */

const CACHE_KEY = 'curator_auth';

export type CuratorAuthCache = { ok: true; role: 'admin' };

export function readCuratorAuthCache(): CuratorAuthCache | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    const p = parsed as Record<string, unknown> | null;
    if (
      p &&
      typeof p === 'object' &&
      p['ok'] === true &&
      p['role'] === 'admin'
    ) {
      return { ok: true, role: p['role'] } as CuratorAuthCache;
    }
    return null;
  } catch {
    return null;
  }
}

export function writeCuratorAuthCache(role: 'admin'): void {
  if (typeof window === 'undefined') return;
  try {
    const payload: CuratorAuthCache = { ok: true, role };
    localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  } catch {
    // ignore
  }
}

export function clearCuratorAuthCache(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    // ignore
  }
}

export function isCuratorAuthCacheValid(cache: CuratorAuthCache | null): boolean {
  return cache !== null && cache.ok === true && cache.role === 'admin';
}
