'use client';

import { getAddress, isAddress, type Address } from 'viem';
import type { SafeRole } from '@/lib/safe/config';

const STORAGE_KEY = 'curator-safe-custom-tokens-v1';
const CHANGE_EVENT = 'curator-safe-custom-tokens-change';

type Store = Partial<Record<SafeRole, Address[]>>;

const EMPTY: Address[] = [];

let memoryStore: Store | null = null;
const roleListCache = new Map<SafeRole, Address[]>();

function readStore(): Store {
  if (memoryStore !== null) return memoryStore;
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    memoryStore = raw ? (JSON.parse(raw) as Store) : {};
  } catch {
    memoryStore = {};
  }
  return memoryStore;
}

function writeStore(next: Store): void {
  memoryStore = next;
  roleListCache.clear();
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function subscribeCustomTokens(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const handler = () => {
    memoryStore = null;
    roleListCache.clear();
    onChange();
  };
  window.addEventListener(CHANGE_EVENT, handler);
  window.addEventListener('storage', handler);
  return () => {
    window.removeEventListener(CHANGE_EVENT, handler);
    window.removeEventListener('storage', handler);
  };
}

/** Referentially stable per role so useSyncExternalStore does not loop. */
export function getCustomTokens(role: SafeRole): Address[] {
  const cached = roleListCache.get(role);
  if (cached) return cached;
  const list = readStore()[role];
  if (!list || list.length === 0) return EMPTY;
  roleListCache.set(role, list);
  return list;
}

export function addCustomToken(role: SafeRole, token: string): void {
  if (!isAddress(token)) throw new Error('Not a valid token address.');
  const address = getAddress(token);
  const store = readStore();
  const existing = store[role] ?? [];
  if (existing.some((t) => t.toLowerCase() === address.toLowerCase())) return;
  writeStore({ ...store, [role]: [...existing, address] });
}

export function removeCustomToken(role: SafeRole, token: Address): void {
  const store = readStore();
  const existing = store[role] ?? [];
  writeStore({
    ...store,
    [role]: existing.filter((t) => t.toLowerCase() !== token.toLowerCase()),
  });
}
