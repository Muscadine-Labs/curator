import { getAddress, isAddress, type Address } from 'viem';

const STORAGE_KEY = 'curator-safe-address-book-v1';
const CHANGE_EVENT = 'curator-safe-address-book-change';

export type SafeAddressBookEntry = {
  address: Address;
  label: string;
};

/** Stable empty snapshot so useSyncExternalStore does not loop. */
export const EMPTY_ADDRESS_BOOK: SafeAddressBookEntry[] = [];

let cached: SafeAddressBookEntry[] | null = null;

function readEntries(): SafeAddressBookEntry[] {
  if (cached) return cached;
  if (typeof window === 'undefined') return EMPTY_ADDRESS_BOOK;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      cached = EMPTY_ADDRESS_BOOK;
      return cached;
    }
    const parsed = JSON.parse(raw) as SafeAddressBookEntry[];
    if (!Array.isArray(parsed)) {
      cached = EMPTY_ADDRESS_BOOK;
      return cached;
    }
    const list = parsed.filter((row) => isAddress(row.address));
    cached = list.length === 0 ? EMPTY_ADDRESS_BOOK : list;
    return cached;
  } catch {
    cached = EMPTY_ADDRESS_BOOK;
    return cached;
  }
}

function writeEntries(entries: SafeAddressBookEntry[]): void {
  cached = entries.length === 0 ? EMPTY_ADDRESS_BOOK : entries;
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cached));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function listAddressBook(): SafeAddressBookEntry[] {
  return readEntries();
}

export function upsertAddressBookEntry(address: string, label: string): void {
  if (!isAddress(address)) return;
  const normalized = getAddress(address);
  const trimmed = label.trim() || `${normalized.slice(0, 6)}…${normalized.slice(-4)}`;
  const next = readEntries().filter(
    (row) => row.address.toLowerCase() !== normalized.toLowerCase()
  );
  next.unshift({ address: normalized, label: trimmed });
  writeEntries(next.slice(0, 50));
}

export function removeAddressBookEntry(address: string): void {
  writeEntries(readEntries().filter((row) => row.address.toLowerCase() !== address.toLowerCase()));
}

export function subscribeAddressBook(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const handler = () => {
    cached = null;
    onChange();
  };
  window.addEventListener(CHANGE_EVENT, handler);
  window.addEventListener('storage', handler);
  return () => {
    window.removeEventListener(CHANGE_EVENT, handler);
    window.removeEventListener('storage', handler);
  };
}
