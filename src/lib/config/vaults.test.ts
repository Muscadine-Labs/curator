import { describe, expect, it } from 'vitest';
import {
  withFetchedVaultNames,
  getAllVaultAddresses,
  getConfiguredVaultDisplayName,
  getSidebarNavVaults,
  getVaultListKind,
  getVaultPageHref,
  groupVaultsByKindAndCategory,
} from '@/lib/config/vaults';

const USDC_PRIME = '0x89712980Cb434eF5aE4AB29349419eb976B0b496';
const RETIRED_USDC_PRIME_WRAPPER = '0x036A01eFdDC87F6634FFDE0533EE528b90fc7A45';

describe('getConfiguredVaultDisplayName', () => {
  it('keeps the Muscadine prefix for strategy vaults', () => {
    expect(
      getConfiguredVaultDisplayName({
        assetSymbol: 'USDC',
        listCategory: 'prime',
      })
    ).toBe('Muscadine USDC Prime');
  });
});

describe('groupVaultsByKindAndCategory', () => {
  it('groups strategy vaults by Prime / Frontier / Test', () => {
    const grouped = groupVaultsByKindAndCategory(getAllVaultAddresses());
    expect(grouped.map((g) => g.kind)).toEqual(['underlying']);
    expect(grouped[0].categories.map((c) => c.category)).toEqual([
      'prime',
      'frontier',
      'test',
    ]);
    expect(getVaultListKind()).toBe('underlying');
  });
});

describe('getVaultPageHref', () => {
  it('keeps strategy vaults on their own page', () => {
    expect(getVaultPageHref(USDC_PRIME).toLowerCase()).toBe(
      `/vault/${USDC_PRIME}`.toLowerCase()
    );
  });
});

describe('getSidebarNavVaults', () => {
  it('lists strategy vaults with configured display names', () => {
    const nav = getSidebarNavVaults();
    expect(nav.some((v) => v.address.toLowerCase() === USDC_PRIME.toLowerCase())).toBe(true);
    expect(
      nav.some((v) => v.address.toLowerCase() === RETIRED_USDC_PRIME_WRAPPER.toLowerCase())
    ).toBe(false);
    const usdc = nav.find((v) => v.address.toLowerCase() === USDC_PRIME.toLowerCase());
    expect(usdc?.name).toBe('Muscadine USDC Prime');
  });
});

describe('withFetchedVaultNames', () => {
  const configured = [
    { address: '0xAaA0000000000000000000000000000000000001', chainId: 8453, name: 'Fallback A' },
    { address: '0xBbB0000000000000000000000000000000000002', chainId: 8453, name: 'Fallback B' },
  ];

  it('keeps fallback names until the list loads', () => {
    expect(withFetchedVaultNames(configured, undefined)).toEqual(configured);
    expect(withFetchedVaultNames(configured, [])).toEqual(configured);
  });

  it('uses the fetched name, matching addresses case-insensitively', () => {
    const result = withFetchedVaultNames(configured, [
      { address: '0xaaa0000000000000000000000000000000000001', name: '  Morpho A ' },
    ]);
    expect(result[0].name).toBe('Morpho A');
    expect(result[1].name).toBe('Fallback B');
  });

  it('ignores missing, blank and placeholder names', () => {
    const result = withFetchedVaultNames(configured, [
      { address: configured[0].address, name: 'Unknown Vault' },
      { address: configured[1].address, name: '   ' },
    ]);
    expect(result.map((v) => v.name)).toEqual(['Fallback A', 'Fallback B']);
  });
});
