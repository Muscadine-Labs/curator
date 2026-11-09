import { getAddress, isAddress, isHex, type Address } from 'viem';
import { inferSafeTxSource } from '@/lib/safe/decode-vault-calldata-preview';
import type { SafePendingTransaction, SafeTransactionStatus } from '@/lib/safe/types';
import { getSafeByAddress, type SafeRole } from '@/lib/safe/config';

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
  // Copy first: the current array is the snapshot React already rendered.
  const transactions = [...readStore().transactions];
  const idx = transactions.findIndex((t) => t.id === tx.id);
  if (idx >= 0) transactions[idx] = tx;
  else transactions.unshift(tx);
  writeStore({ transactions });
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

/** Imported signatures with a valid signer and hex data, one per signer. */
function sanitizeImportedSignatures(
  signatures: unknown
): SafePendingTransaction['signatures'] {
  if (!Array.isArray(signatures)) return [];
  const out: SafePendingTransaction['signatures'] = [];
  const seen = new Set<string>();
  for (const sig of signatures as Array<Partial<SafePendingTransaction['signatures'][number]>>) {
    if (!sig?.signer || !isAddress(sig.signer)) continue;
    if (typeof sig.data !== 'string' || !isHex(sig.data)) continue;
    const key = sig.signer.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      signer: getAddress(sig.signer),
      data: sig.data,
      signedAt: typeof sig.signedAt === 'string' ? sig.signedAt : '',
    });
  }
  return out;
}

/**
 * Drop a stored preview and re-classify from calldata. A JSON bundle is
 * untrusted: a misleading title must not survive import while the calldata
 * does something else, and the row must belong to the configured Safe it is
 * filed under. Returns null for a row that cannot be used.
 */
export function sanitizeImportedPending(tx: SafePendingTransaction): SafePendingTransaction | null {
  if (!tx || typeof tx !== 'object') return null;
  if (!isAddress(String(tx.safeAddress)) || !isAddress(String(tx.to))) return null;
  if (typeof tx.data !== 'string' || !isHex(tx.data)) return null;
  // value / nonce are later fed to BigInt / Number: only plain integers pass.
  const value = tx.value == null || tx.value === '' ? '0' : String(tx.value);
  if (!/^\d+$/.test(value) || !/^\d+$/.test(String(tx.nonce))) return null;
  if (tx.operation !== 0 && tx.operation !== 1) return null;
  // The role comes from our own config, never from the bundle.
  const safe = getSafeByAddress(tx.safeAddress);
  if (!safe) return null;
  return {
    ...tx,
    id: typeof tx.id === 'string' && tx.id ? tx.id : newImportId(),
    safeRole: safe.role,
    safeAddress: getAddress(safe.address),
    to: getAddress(tx.to),
    value,
    nonce: String(tx.nonce),
    // Readiness is re-derived from owner signatures against the live threshold.
    status: 'awaiting_signatures',
    signatures: sanitizeImportedSignatures(tx.signatures),
    preview: null,
    // Curator writes this at queue time; text from another browser's bundle is not ours.
    simulationWarning: null,
    source: inferSafeTxSource(getAddress(tx.to), tx.data, value, tx.operation),
  };
}

function newImportId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Fold an imported copy of a proposal we already hold into the local one. The
 * local row keeps its own fields; only signatures are unioned by signer, so
 * importing another owner's bundle never drops a signature collected here.
 */
function mergeImportedPending(
  local: SafePendingTransaction,
  imported: SafePendingTransaction
): SafePendingTransaction {
  const signatures = [...local.signatures];
  const seen = new Set(signatures.map((sig) => sig.signer.toLowerCase()));
  for (const sig of sanitizeImportedSignatures(imported.signatures)) {
    const key = sig.signer.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    signatures.push(sig);
  }
  const becameReady =
    local.status === 'awaiting_signatures' &&
    imported.status === 'ready' &&
    signatures.length > local.signatures.length;
  return {
    ...local,
    signatures,
    status: becameReady ? 'ready' : local.status,
    updatedAt: new Date().toISOString(),
  };
}

export function importPendingBundle(
  json: string
): { ok: true; count: number; skipped: number } | { ok: false; error: string } {
  let parsed: StoreSnapshot;
  try {
    parsed = JSON.parse(json) as StoreSnapshot;
  } catch {
    return { ok: false, error: 'Could not parse JSON bundle.' };
  }
  if (!parsed || !Array.isArray(parsed.transactions)) {
    return { ok: false, error: 'Invalid bundle: missing transactions array.' };
  }
  const existing = readStore().transactions;
  const byHash = new Map(existing.map((tx) => [tx.safeTxHash.toLowerCase(), tx]));
  let count = 0;
  let skipped = 0;
  for (const tx of parsed.transactions) {
    if (!tx?.safeTxHash || !isHex(String(tx.safeTxHash))) {
      skipped += 1;
      continue;
    }
    const key = String(tx.safeTxHash).toLowerCase();
    const local = byHash.get(key);
    // One bad row must not discard the rest of the bundle.
    let next: SafePendingTransaction | null;
    try {
      next = local ? mergeImportedPending(local, tx) : sanitizeImportedPending(tx);
    } catch {
      next = null;
    }
    if (!next) {
      skipped += 1;
      continue;
    }
    byHash.set(key, next);
    count += 1;
  }
  writeStore({ transactions: [...byHash.values()] });
  notifyListeners();
  return { ok: true, count, skipped };
}
