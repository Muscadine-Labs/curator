import { getAddress, isAddress, type Address } from 'viem';

const STORAGE_KEY = 'curator-safe-address-book-v1';
const CHANGE_EVENT = 'curator-safe-address-book-change';

export type SafeAddressBookEntry = {
  address: Address;
  label: string;
};

/** Stable empty snapshot so useSyncExternalStore does not loop. */
export const EMPTY_ADDRESS_BOOK: SafeAddressBookEntry[] = [];

// Snapshot plus the raw string it was parsed from. Comparing the raw string on
// each read keeps the snapshot stable for useSyncExternalStore while still
// picking up writes from another tab made while nothing was subscribed.
let cached: { raw: string | null; entries: SafeAddressBookEntry[] } | null = null;

function parseEntries(raw: string | null): SafeAddressBookEntry[] {
  if (!raw) return EMPTY_ADDRESS_BOOK;
  try {
    const parsed = JSON.parse(raw) as SafeAddressBookEntry[];
    if (!Array.isArray(parsed)) return EMPTY_ADDRESS_BOOK;
    const list = parsed.filter((row) => isAddress(row?.address));
    return list.length === 0 ? EMPTY_ADDRESS_BOOK : list;
  } catch {
    return EMPTY_ADDRESS_BOOK;
  }
}

function readEntries(): SafeAddressBookEntry[] {
  if (typeof window === 'undefined') return EMPTY_ADDRESS_BOOK;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return cached?.entries ?? EMPTY_ADDRESS_BOOK;
  }
  if (cached && cached.raw === raw) return cached.entries;
  cached = { raw, entries: parseEntries(raw) };
  return cached.entries;
}

function writeEntries(entries: SafeAddressBookEntry[]): void {
  if (typeof window === 'undefined') return;
  const next = entries.length === 0 ? EMPTY_ADDRESS_BOOK : entries;
  const raw = JSON.stringify(next);
  window.localStorage.setItem(STORAGE_KEY, raw);
  cached = { raw, entries: next };
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function listAddressBook(): SafeAddressBookEntry[] {
  return readEntries();
}

/**
 * Add or move an entry to the front. An empty `label` (e.g. recording a Send
 * recipient) keeps the existing label rather than overwriting it with the
 * shortened address.
 */
export function upsertAddressBookEntry(address: string, label: string): void {
  if (!isAddress(address)) return;
  const normalized = getAddress(address);
  const entries = readEntries();
  const existing = entries.find(
    (row) => row.address.toLowerCase() === normalized.toLowerCase()
  );
  const trimmed =
    label.trim() ||
    existing?.label?.trim() ||
    `${normalized.slice(0, 6)}…${normalized.slice(-4)}`;
  const next = entries.filter(
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
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}
