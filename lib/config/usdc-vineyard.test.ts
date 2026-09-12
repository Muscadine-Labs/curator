import { describe, expect, it } from 'vitest';
import { getSafeByRole } from '@/lib/safe/config';
import {
  MORPHO_ADAPTER_REGISTRY_BASE,
  muscadineVineyardRoles,
  USDC_FRONTIER_VAULT,
  USDC_PRIME_VAULT,
  USDC_VINEYARD_ADAPTER_TARGETS,
  USDC_VINEYARD_ASSET,
  USDC_VINEYARD_CHAIN_ID,
  USDC_VINEYARD_NAME,
  USDC_VINEYARD_SYMBOL,
} from '@/lib/config/usdc-vineyard';
import { BASE_CHAIN_ID, BASE_USDC_ADDRESS } from '@/lib/constants';

describe('usdc-vineyard config', () => {
  it('names the vault Muscadine USDC Vineyard / mvUSDC on Base USDC', () => {
    expect(USDC_VINEYARD_NAME).toBe('Muscadine USDC Vineyard');
    expect(USDC_VINEYARD_SYMBOL).toBe('mvUSDC');
    expect(USDC_VINEYARD_CHAIN_ID).toBe(BASE_CHAIN_ID);
    expect(USDC_VINEYARD_ASSET.toLowerCase()).toBe(BASE_USDC_ADDRESS.toLowerCase());
  });

  it('uses the same Owner / Curator / Allocator / Sentinel Safes as Prime', () => {
    const roles = muscadineVineyardRoles();
    expect(roles.owner).toBe(getSafeByRole('owner').address);
    expect(roles.curator).toBe(getSafeByRole('curator').address);
    expect(roles.allocator).toBe(getSafeByRole('allocator').address);
    expect(roles.sentinel).toBe(getSafeByRole('sentinel').address);
  });

  it('targets Prime then Frontier via two MorphoVaultV1Adapters', () => {
    expect(USDC_VINEYARD_ADAPTER_TARGETS).toHaveLength(2);
    expect(USDC_VINEYARD_ADAPTER_TARGETS[0]).toEqual({
      label: 'Muscadine USDC Prime',
      childVault: USDC_PRIME_VAULT,
      liquidity: true,
    });
    expect(USDC_VINEYARD_ADAPTER_TARGETS[1]).toEqual({
      label: 'Muscadine USDC Frontier',
      childVault: USDC_FRONTIER_VAULT,
      liquidity: false,
    });
  });

  it('keeps Morpho adapter registry as a documented skip, not a deploy target', () => {
    expect(MORPHO_ADAPTER_REGISTRY_BASE.toLowerCase()).toBe(
      '0x5c2531cbd2cf112cf687da3cd536708add7db10a'
    );
    expect(MORPHO_ADAPTER_REGISTRY_BASE).not.toBe(muscadineVineyardRoles().owner);
    expect(MORPHO_ADAPTER_REGISTRY_BASE).not.toBe(muscadineVineyardRoles().curator);
  });
});
