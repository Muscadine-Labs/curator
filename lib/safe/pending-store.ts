import { getAddress, type Address } from 'viem';
import type { SafePendingTransaction, SafeTransactionStatus } from '@/lib/safe/types';
import type { SafeRole } from '@/lib/safe/config';

const STORAGE_KEY = 'curator-safe-pending-v1';

type StoreSnapshot = {
  transactions: SafePendingTransaction[];
};

const EMPTY_TRANSACTIONS: SafePendingTransaction[] = [];
const EMPTY_SNAPSHOT: StoreSnapshot = { transactions: EMPTY_TRANSACTIONS };

/** In-memory cache so useSyncExternalStore snapshots stay referentially stable. */
let memoryStore: StoreSnapshot | null = null;
const roleListCache = new Map<SafeRole, SafePendingTransaction[]>();

function invalidateCache(): void {
  memoryStore = null;
  roleListCache.clear();
}

function loadStoreFromStorage(): StoreSnapshot {
  if (typeof window === 'undefined') return EMPTY_SNAPSHOT;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_SNAPSHOT;
    const parsed = JSON.parse(raw) as StoreSnapshot;
    if (!Array.isArray(parsed.transactions)) return EMPTY_SNAPSHOT;
    return parsed;
  } catch {
    return EMPTY_SNAPSHOT;
  }
}

function readStore(): StoreSnapshot {
  if (memoryStore === null) {
    memoryStore = loadStoreFromStorage();
  }
  return memoryStore;
}

function writeStore(snapshot: StoreSnapshot): void {
  memoryStore = snapshot;
  roleListCache.clear();
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
}

function notifyListeners(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event('curator-safe-pending-change'));
}

export function subscribeSafePending(onStoreChange: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const handler = () => {
    invalidateCache();
    onStoreChange();
  };
  window.addEventListener('curator-safe-pending-change', handler);
  window.addEventListener('storage', handler);
  return () => {
    window.removeEventListener('curator-safe-pending-change', handler);
    window.removeEventListener('storage', handler);
  };
}

export function getSafePendingSnapshot(): SafePendingTransaction[] {
  return readStore().transactions;
}

export function listPendingForRole(role: SafeRole): SafePendingTransaction[] {
  const cached = roleListCache.get(role);
  if (cached) return cached;

  const items = getSafePendingSnapshot().filter(
    (tx) =>
      tx.safeRole === role &&
      (tx.status === 'awaiting_signatures' || tx.status === 'ready')
  );
  roleListCache.set(role, items);
  return items;
}

export function countPendingForRole(role: SafeRole): number {
  return listPendingForRole(role).length;
}

export function getPendingById(id: string): SafePendingTransaction | undefined {
  return getSafePendingSnapshot().find((tx) => tx.id === id);
}

export function upsertPendingTransaction(tx: SafePendingTransaction): void {
  const store = readStore();
  const idx = store.transactions.findIndex((t) => t.id === tx.id);
  if (idx >= 0) store.transactions[idx] = tx;
  else store.transactions.unshift(tx);
  writeStore({ transactions: [...store.transactions] });
  notifyListeners();
}

export function updatePendingTransaction(
  id: string,
  patch: Partial<SafePendingTransaction>
): SafePendingTransaction | undefined {
  const store = readStore();
  const idx = store.transactions.findIndex((t) => t.id === id);
  if (idx < 0) return undefined;
  const updated = {
    ...store.transactions[idx],
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  const transactions = [...store.transactions];
  transactions[idx] = updated;
  writeStore({ transactions });
  notifyListeners();
  return updated;
}

export function setPendingStatus(id: string, status: SafeTransactionStatus): void {
  updatePendingTransaction(id, { status });
}

export function removePendingTransaction(id: string): void {
  const store = readStore();
  writeStore({
    transactions: store.transactions.filter((t) => t.id !== id),
  });
  notifyListeners();
}

export function addSignature(
  id: string,
  signer: Address,
  data: `0x${string}`
): SafePendingTransaction | undefined {
  const tx = getPendingById(id);
  if (!tx) return undefined;

  const normalized = getAddress(signer);
  const signatures = tx.signatures.filter(
    (s) => getAddress(s.signer).toLowerCase() !== normalized.toLowerCase()
  );
  signatures.push({
    signer: normalized,
    data,
    signedAt: new Date().toISOString(),
  });

  return updatePendingTransaction(id, { signatures });
}

export function exportPendingBundle(): string {
  return JSON.stringify(readStore(), null, 2);
}

export function importPendingBundle(json: string): { ok: true; count: number } | { ok: false; error: string } {
  try {
    const parsed = JSON.parse(json) as StoreSnapshot;
    if (!Array.isArray(parsed.transactions)) {
      return { ok: false, error: 'Invalid bundle: missing transactions array.' };
    }
    writeStore(parsed);
    notifyListeners();
    return { ok: true, count: parsed.transactions.length };
  } catch {
    return { ok: false, error: 'Could not parse JSON bundle.' };
  }
}
