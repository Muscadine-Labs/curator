import { isTestingVaultAddress } from '@/lib/config/vaults';

const PUBLIC_VAULT_READS = new Set([
  'history',
  'risk',
  'governance',
  'pending',
  'reallocations',
]);

export function normalizePath(pathname: string): string {
  const path = pathname.split('?')[0] ?? pathname;
  if (path.length > 1 && path.endsWith('/')) return path.slice(0, -1);
  return path;
}

/**
 * Address for a public vault read (`/api/vaults/:id` and the read subroutes).
 * Write, holder, gate, and transaction routes return null.
 */
export function publicVaultReadAddress(pathname: string): string | null {
  const path = normalizePath(pathname);
  const match = path.match(/^\/api\/vaults\/([^/]+)(?:\/([^/]+))?$/);
  if (!match) return null;
  const sub = match[2];
  if (sub && !PUBLIC_VAULT_READS.has(sub)) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

/** GET routes that power Overview, Vaults, and Markets. */
export function isPublicCuratorGet(pathname: string): boolean {
  const path = normalizePath(pathname);
  if (path === '/api/protocol-stats' || path === '/api/vaults') return true;
  if (publicVaultReadAddress(path)) return true;
  if (path === '/api/markets' || path.startsWith('/api/markets/')) return true;
  return false;
}

/** Anonymous GET of overview, vault, and market data. Testing vaults stay private. */
export function anonymousMayRead(method: string, pathname: string): boolean {
  if (method !== 'GET' || !isPublicCuratorGet(pathname)) return false;
  const vaultAddress = publicVaultReadAddress(pathname);
  if (vaultAddress && isTestingVaultAddress(vaultAddress)) return false;
  return true;
}

export function isTestingVaultPage(pathname: string): boolean {
  const path = normalizePath(pathname);
  const match = path.match(/^\/vault\/(0x[a-fA-F0-9]{40})(?:\/|$)/i);
  if (!match) return false;
  return isTestingVaultAddress(match[1]);
}

export function isVaultSentinelPage(pathname: string): boolean {
  const path = normalizePath(pathname);
  return /^\/vault\/0x[a-fA-F0-9]{40}\/sentinel(?:\/|$)/i.test(path);
}
