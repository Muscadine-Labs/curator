import { describe, expect, it } from 'vitest';
import {
  withFetchedVaultNames,
  getAllVaultAddresses,
  getConfiguredVaultDisplayName,
  getSidebarNavVaults,
  getVaultPageHref,
  groupVaultsByCategory,
  vaultDisplayName,
} from '@/lib/config/vaults';

const USDC_PRIME = '0x89712980Cb434eF5aE4AB29349419eb976B0b496';

describe('vaultDisplayName', () => {
  it('uses the Morpho name, trimmed', () => {
    expect(vaultDisplayName('  USDC Prime ')).toBe('USDC Prime');
  });

  it('falls back when the name is missing or blank', () => {
    expect(vaultDisplayName(null)).toBe('Unknown Vault');
    expect(vaultDisplayName('  ', 'Custom')).toBe('Custom');
  });
});

describe('getConfiguredVaultDisplayName', () => {
  it('keeps the Muscadine prefix', () => {
    expect(
      getConfiguredVaultDisplayName({ assetSymbol: 'USDC', listCategory: 'prime' })
    ).toBe('Muscadine USDC Prime');
  });
});

describe('vault config', () => {
  it('has no fee wrappers or adapter-only entries', () => {
    for (const vault of getAllVaultAddresses()) {
      expect(Object.keys(vault)).not.toContain('kind');
      expect(Object.keys(vault)).not.toContain('underlyingAddress');
      expect(Object.keys(vault)).not.toContain('adapterAddress');
    }
  });
});

describe('groupVaultsByCategory', () => {
  it('groups Prime / Frontier / Test in order and drops empty groups', () => {
    const grouped = groupVaultsByCategory(getAllVaultAddresses());
    expect(grouped.map((g) => g.category)).toEqual(['prime', 'frontier', 'test']);
    expect(grouped.reduce((n, g) => n + g.vaults.length, 0)).toBe(
      getAllVaultAddresses().length
    );
  });
});

describe('getVaultPageHref', () => {
  it('links a vault to its own page', () => {
    expect(getVaultPageHref(USDC_PRIME)).toBe(`/vault/${USDC_PRIME}`);
    expect(getVaultPageHref(USDC_PRIME, 'caps')).toBe(`/vault/${USDC_PRIME}/caps`);
  });
});

describe('getSidebarNavVaults', () => {
  it('lists configured vaults with configured display names', () => {
    const nav = getSidebarNavVaults();
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
