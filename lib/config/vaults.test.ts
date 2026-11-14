import { describe, expect, it } from 'vitest';
import {
  withFetchedVaultNames,
  getAllVaultAddresses,
  getConfiguredVaultDisplayName,
  getFeeWrapperForUnderlying,
  getSidebarNavVaults,
  getVaultByAdapterAddress,
  getVaultListKind,
  getVaultPageHref,
  groupVaultsByKindAndCategory,
  isFeeWrapperAdapterAddress,
  withFeeWrapperLabel,
} from '@/lib/config/vaults';

const USDC_PRIME =
  process.env.NEXT_PUBLIC_VAULT_USDC_V2 || '0x89712980Cb434eF5aE4AB29349419eb976B0b496';
const USDC_PRIME_WRAPPER =
  process.env.NEXT_PUBLIC_VAULT_USDC_PRIME_WRAPPER ||
  '0x036A01eFdDC87F6634FFDE0533EE528b90fc7A45';

describe('withFeeWrapperLabel', () => {
  it('appends (wrapper) for configured fee-wrapper addresses', () => {
    expect(withFeeWrapperLabel('USDC Prime', USDC_PRIME_WRAPPER)).toBe(
      'USDC Prime (wrapper)'
    );
  });

  it('does not append (wrapper) for strategy vault addresses', () => {
    expect(withFeeWrapperLabel('Muscadine USDC Prime', USDC_PRIME)).toBe(
      'Muscadine USDC Prime'
    );
  });

  it('is idempotent when the suffix is already present', () => {
    expect(withFeeWrapperLabel('USDC Prime (wrapper)', USDC_PRIME_WRAPPER)).toBe(
      'USDC Prime (wrapper)'
    );
    expect(withFeeWrapperLabel('USDC Prime (Wrapper)', USDC_PRIME_WRAPPER)).toBe(
      'USDC Prime (Wrapper)'
    );
  });

  it('uses the fallback when the name is missing', () => {
    expect(withFeeWrapperLabel(null, USDC_PRIME_WRAPPER)).toBe('Unknown Vault (wrapper)');
    expect(withFeeWrapperLabel('  ', USDC_PRIME_WRAPPER, 'Custom')).toBe('Custom (wrapper)');
  });
});

describe('getVaultByAdapterAddress', () => {
  it('resolves the USDC Prime wrapper from its MorphoVaultV2Adapter', () => {
    const adapter = getVaultByAdapterAddress(
      '0x8b6e43cce1961d3671a39fe8d9e711e69ddd74ce'
    );
    expect(adapter?.kind).toBe('feeWrapper');
    expect(adapter?.address.toLowerCase()).toBe(USDC_PRIME_WRAPPER.toLowerCase());
    expect(isFeeWrapperAdapterAddress('0x8B6E43CCE1961D3671a39Fe8D9E711E69ddD74ce')).toBe(
      true
    );
    expect(isFeeWrapperAdapterAddress(USDC_PRIME_WRAPPER)).toBe(false);
  });
});

describe('getConfiguredVaultDisplayName', () => {
  it('includes (wrapper) for fee-wrapper config', () => {
    expect(
      getConfiguredVaultDisplayName({
        assetSymbol: 'USDC',
        listCategory: 'prime',
        kind: 'feeWrapper',
      })
    ).toBe('USDC Prime (wrapper)');
  });

  it('keeps the Muscadine prefix for strategy vaults', () => {
    expect(
      getConfiguredVaultDisplayName({
        assetSymbol: 'USDC',
        listCategory: 'prime',
        kind: 'strategy',
      })
    ).toBe('Muscadine USDC Prime');
  });
});

describe('groupVaultsByKindAndCategory', () => {
  it('puts fee wrappers after underlying, then Prime / Frontier / Test', () => {
    const grouped = groupVaultsByKindAndCategory(getAllVaultAddresses());
    expect(grouped.map((g) => g.kind)).toEqual(['underlying', 'wrapper']);
    expect(grouped[0].categories.map((c) => c.category)).toEqual([
      'prime',
      'frontier',
      'test',
    ]);
    expect(
      grouped[0].categories.every((c) =>
        c.vaults.every((v) => getVaultListKind(v) === 'underlying')
      )
    ).toBe(true);
    expect(
      grouped[1].categories.every((c) =>
        c.vaults.every((v) => getVaultListKind(v) === 'wrapper')
      )
    ).toBe(true);
  });

  it('classifies configured fee wrappers as wrapper', () => {
    expect(getVaultListKind({ kind: 'feeWrapper' })).toBe('wrapper');
    expect(getVaultListKind({ kind: 'strategy' })).toBe('underlying');
    expect(getVaultListKind({})).toBe('underlying');
  });
});

describe('getFeeWrapperForUnderlying', () => {
  it('resolves the USDC Prime wrapper from the strategy vault', () => {
    const wrapper = getFeeWrapperForUnderlying(USDC_PRIME);
    expect(wrapper?.kind).toBe('feeWrapper');
    expect(wrapper?.address.toLowerCase()).toBe(USDC_PRIME_WRAPPER.toLowerCase());
  });

  it('does not treat a wrapper as having its own wrapper', () => {
    expect(getFeeWrapperForUnderlying(USDC_PRIME_WRAPPER)).toBeUndefined();
  });
});

describe('getVaultPageHref', () => {
  it('keeps strategy vaults on their own page', () => {
    expect(getVaultPageHref(USDC_PRIME).toLowerCase()).toBe(
      `/vault/${USDC_PRIME}`.toLowerCase()
    );
  });

  it('sends fee-wrapper addresses to the underlying Fee wrapper tab', () => {
    expect(getVaultPageHref(USDC_PRIME_WRAPPER).toLowerCase()).toBe(
      `/vault/${USDC_PRIME}/fee-wrapper`.toLowerCase()
    );
  });
});

describe('getSidebarNavVaults', () => {
  it('lists underlyings only, with configured display names', () => {
    const nav = getSidebarNavVaults();
    expect(nav.every((v) => v.kind !== 'feeWrapper')).toBe(true);
    expect(nav.some((v) => v.address.toLowerCase() === USDC_PRIME.toLowerCase())).toBe(
      true
    );
    expect(nav.some((v) => v.address.toLowerCase() === USDC_PRIME_WRAPPER.toLowerCase())).toBe(
      false
    );
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
