import { describe, expect, it } from 'vitest';
import { vaultAdapterProduct } from './vault-v2-adapter';

describe('vaultAdapterProduct', () => {
  it('treats Morpho Market V1 as Blue and a Midnight adapter as Midnight', () => {
    expect(vaultAdapterProduct({ __typename: 'MorphoMarketV1Adapter', type: 'MorphoMarketV1' })).toBe(
      'blue'
    );
    expect(vaultAdapterProduct({ __typename: 'MidnightAdapter', type: 'Midnight' })).toBe('midnight');
    expect(vaultAdapterProduct({ __typename: 'MorphoVaultV2Adapter', type: 'MorphoVaultV2' })).toBe(
      null
    );
  });
});
