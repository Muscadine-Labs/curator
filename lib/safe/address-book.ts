import { getAddress, isAddress, type Address } from 'viem';

const STORAGE_KEY = 'curator-safe-address-book-v1';

export type SafeAddressBookEntry = {
  address: Address;
  label: string;
};

function readEntries(): SafeAddressBookEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SafeAddressBookEntry[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((row) => isAddress(row.address));
  } catch {
    return [];
  }
}

function writeEntries(entries: SafeAddressBookEntry[]): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  window.dispatchEvent(new Event('curator-safe-address-book-change'));
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
  window.addEventListener('curator-safe-address-book-change', onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener('curator-safe-address-book-change', onChange);
    window.removeEventListener('storage', onChange);
  };
}
