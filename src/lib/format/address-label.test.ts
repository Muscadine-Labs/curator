import { describe, expect, it } from 'vitest';
import {
  getDepositorLabel,
  resolveDepositorLabel,
} from '@/lib/format/address-label';
import { TREASURY_ADDRESS } from '@/lib/morpho/treasury-statement';
import { getSafeByRole } from '@/lib/safe/config';

const USDC_PRIME = '0x89712980Cb434eF5aE4AB29349419eb976B0b496';
const USDC_PRIME_WRAPPER = '0x036A01eFdDC87F6634FFDE0533EE528b90fc7A45';

describe('resolveDepositorLabel', () => {
  it('labels the treasury Safe as Treasury', () => {
    expect(resolveDepositorLabel(TREASURY_ADDRESS)).toEqual({
      address: TREASURY_ADDRESS,
      label: 'Treasury',
      kind: 'treasury',
    });
    expect(getDepositorLabel(TREASURY_ADDRESS.toLowerCase())).toBe('Treasury');
  });

  it('labels fee wrappers with the configured wrapper name', () => {
    const resolved = resolveDepositorLabel(USDC_PRIME_WRAPPER);
    expect(resolved?.kind).toBe('fee_wrapper');
    expect(resolved?.label).toBe('USDC Prime (wrapper)');
  });

  it('labels the wrapper MorphoVaultV2Adapter as the parent wrapper', () => {
    const usdcPrimeAdapter = '0x8B6E43CCE1961D3671a39Fe8D9E711E69ddD74ce';
    const resolved = resolveDepositorLabel(usdcPrimeAdapter.toLowerCase());
    expect(resolved?.kind).toBe('fee_wrapper');
    expect(resolved?.label).toBe('USDC Prime (wrapper)');
    expect(resolveDepositorLabel('0x5b211DA4Cd92cfb9CCCFbd1De78289955EB236CD')?.label).toBe(
      'USDC Frontier (wrapper)'
    );
    expect(resolveDepositorLabel('0xf691616Dd2cF85c9cA9fa32bdFf00f5cD92BAd81')?.label).toBe(
      'WETH Prime (wrapper)'
    );
    expect(resolveDepositorLabel('0xa3b90423FD6f70B9f4A424dEBfB27ac502ac1464')?.label).toBe(
      'cbBTC Prime (wrapper)'
    );
  });

  it('labels strategy vaults that appear as holders', () => {
    const resolved = resolveDepositorLabel(USDC_PRIME);
    expect(resolved?.kind).toBe('vault');
    expect(resolved?.label).toBe('Muscadine USDC Prime');
  });

  it('labels other known Safes', () => {
    const owner = getSafeByRole('owner');
    expect(resolveDepositorLabel(owner.address)).toEqual({
      address: owner.address,
      label: 'Owner Safe',
      kind: 'safe',
    });
  });

  it('returns null for ordinary wallets', () => {
    expect(
      resolveDepositorLabel('0x1111111111111111111111111111111111111111')
    ).toBeNull();
    expect(getDepositorLabel('0x1111111111111111111111111111111111111111')).toBeNull();
  });
});
