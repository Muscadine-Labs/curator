import { beforeEach, describe, expect, it, vi } from 'vitest';

const ADDRESS = '0x628037c2D25F5e5f6F90415CFf6d7e8860f41C08';

function stubWindow() {
  const store = new Map<string, string>();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    },
    dispatchEvent: () => true,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  });
}

describe('upsertAddressBookEntry', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    stubWindow();
  });

  it('keeps a saved label when re-recorded without one', async () => {
    const book = await import('./address-book');
    book.upsertAddressBookEntry(ADDRESS, 'Rebater');
    book.upsertAddressBookEntry(ADDRESS.toLowerCase(), '');
    expect(book.listAddressBook()).toEqual([{ address: ADDRESS, label: 'Rebater' }]);
  });

  it('falls back to the short address for a new unlabeled entry', async () => {
    const book = await import('./address-book');
    book.upsertAddressBookEntry(ADDRESS, '  ');
    expect(book.listAddressBook()[0]?.label).toBe('0x6280…1C08');
  });

  it('replaces the label when a new one is given', async () => {
    const book = await import('./address-book');
    book.upsertAddressBookEntry(ADDRESS, 'Rebater');
    book.upsertAddressBookEntry(ADDRESS, 'Partner');
    expect(book.listAddressBook()).toEqual([{ address: ADDRESS, label: 'Partner' }]);
  });
});
