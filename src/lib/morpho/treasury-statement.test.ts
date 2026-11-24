import { describe, expect, it } from 'vitest';
import { getVaultAddressesForBusinessViews } from '@/lib/config/vaults';
import {
  VAULT_ASSET_MAP,
  treasuryAssetKeyForVault,
} from '@/lib/morpho/treasury-statement';

describe('VAULT_ASSET_MAP', () => {
  it('includes every business vault from config, including fee wrappers', () => {
    const business = getVaultAddressesForBusinessViews();
    expect(business.some((v) => v.kind === 'feeWrapper')).toBe(true);
    for (const vault of business) {
      expect(VAULT_ASSET_MAP[vault.address.toLowerCase()]).toBe(vault.assetSymbol);
      expect(treasuryAssetKeyForVault(vault.address)).toBe(vault.assetSymbol);
    }
  });
});
