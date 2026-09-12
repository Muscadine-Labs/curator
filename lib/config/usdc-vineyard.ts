/**
 * Muscadine USDC Vineyard (mvUSDC) — meta-allocator Vault V2 on Base.
 *
 * Allocates into Muscadine USDC Prime and USDC Frontier via two
 * MorphoVaultV1Adapters (ERC-4626; GraphQL labels these MorphoVaultV2Adapter
 * when the child is Vault V2).
 *
 * Not registered with Morpho's adapter registry — `setAdapterRegistry` is
 * left unset and is not abdicated, unlike Morpho Curator production vaults.
 */
import type { Address, Hex } from 'viem';
import { keccak256, stringToHex } from 'viem';
import { BASE_CHAIN_ID, BASE_USDC_ADDRESS } from '@/lib/constants';
import { getSafeByRole } from '@/lib/safe/config';

export const USDC_VINEYARD_NAME = 'Muscadine USDC Vineyard';
export const USDC_VINEYARD_SYMBOL = 'mvUSDC';
export const USDC_VINEYARD_CHAIN_ID = BASE_CHAIN_ID;
export const USDC_VINEYARD_ASSET = BASE_USDC_ADDRESS;
export const USDC_VINEYARD_ASSET_DECIMALS = 6;
export const USDC_VINEYARD_ASSET_SYMBOL = 'USDC';

/** CREATE2 salt — changing this changes the predicted vault address. */
export const USDC_VINEYARD_SALT: Hex = keccak256(
  stringToHex('muscadine-usdc-vineyard-mvUSDC-v1')
);

/**
 * Morpho dead-deposit size: 1e12 for assets with ≤ 9 decimals.
 * Deposited on behalf of 0xdead to block inflation attacks.
 */
export const USDC_VINEYARD_DEAD_DEPOSIT = 10n ** 12n;
export const DEAD_SHARES_RECIPIENT = '0x000000000000000000000000000000000000dead' as Address;

export const USDC_PRIME_VAULT =
  '0x89712980Cb434eF5aE4AB29349419eb976B0b496' as Address;
export const USDC_FRONTIER_VAULT =
  '0x314fD07319ef645bA7D548915CCd91F4788A1839' as Address;

/** VaultV2Factory on Base. @see https://docs.morpho.org/developers/contracts/addresses/ */
export const VAULT_V2_FACTORY_BASE =
  '0x4501125508079A99ebBebCE205DeC9593C2b5857' as Address;

/**
 * MorphoVaultV1AdapterFactory on Base. Despite the V1 name, the adapter is
 * ERC-4626 and is what fee wrappers use to deposit into Vault V2 children.
 */
export const MORPHO_VAULT_V1_ADAPTER_FACTORY_BASE =
  '0xF42D9c36b34c9c2CF3Bc30eD2a52a90eEB604642' as Address;

/** Morpho adapter registry on Base — Vineyard must NOT set or abdicate this. */
export const MORPHO_ADAPTER_REGISTRY_BASE =
  '0x5C2531Cbd2cf112Cf687da3Cd536708aDd7DB10a' as Address;

export const WAD = 10n ** 18n;
export const UINT128_MAX = (1n << 128n) - 1n;

export type VineyardRoleAddresses = {
  owner: Address;
  curator: Address;
  allocator: Address;
  sentinel: Address;
};

export function muscadineVineyardRoles(): VineyardRoleAddresses {
  return {
    owner: getSafeByRole('owner').address,
    curator: getSafeByRole('curator').address,
    allocator: getSafeByRole('allocator').address,
    sentinel: getSafeByRole('sentinel').address,
  };
}

export type VineyardAdapterTarget = {
  label: string;
  childVault: Address;
  /** Liquidity adapter = the first target (Prime). */
  liquidity: boolean;
};

export const USDC_VINEYARD_ADAPTER_TARGETS: readonly VineyardAdapterTarget[] = [
  {
    label: 'Muscadine USDC Prime',
    childVault: USDC_PRIME_VAULT,
    liquidity: true,
  },
  {
    label: 'Muscadine USDC Frontier',
    childVault: USDC_FRONTIER_VAULT,
    liquidity: false,
  },
];
