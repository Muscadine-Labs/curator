import type { Address } from 'viem';
import { getSafeByRole } from '@/lib/safe/config';
import {
  BASE_CHAIN_ID,
  ETHEREUM_CHAIN_ID,
  HYPEREVM_CHAIN_ID,
  ROBINHOOD_CHAIN_ID,
} from '@/lib/constants/core';

/**
 * Vault V2 Blue Public Allocator deployments (Morpho `vaultV2BluePublicAllocator`).
 * Distinct from MetaMorpho V1 `publicAllocator` flow-cap contracts.
 * @see https://docs.morpho.org/learn/concepts/public-allocator/
 */
const VAULT_V2_PUBLIC_ALLOCATOR_BY_CHAIN: Record<number, Address> = {
  [ETHEREUM_CHAIN_ID]: '0x00b8e1509398ED692C3F326CbAf1694F9A881e27',
  [BASE_CHAIN_ID]: '0xAED282B8aD9257BB1272e93aE63A32A53621e412',
  [HYPEREVM_CHAIN_ID]: '0x056dd7D4B373ED26c788190085CC6C52B8e7479d',
  [ROBINHOOD_CHAIN_ID]: '0xCe5c1aFa115fF8b1D6913509bfc79D9AE08CC857',
} as const satisfies Record<number, Address>;

/** Public Morpho allocator on Base (not the Muscadine Allocator Safe). */
export const PUBLIC_ALLOCATOR_ADDRESS: Address =
  VAULT_V2_PUBLIC_ALLOCATOR_BY_CHAIN[BASE_CHAIN_ID];

export function getVaultV2PublicAllocatorAddress(chainId: number): Address | null {
  return VAULT_V2_PUBLIC_ALLOCATOR_BY_CHAIN[chainId] ?? null;
}

export function isVaultV2PublicAllocatorAddress(address: string): boolean {
  const needle = address.toLowerCase();
  return Object.values(VAULT_V2_PUBLIC_ALLOCATOR_BY_CHAIN).some(
    (a) => a.toLowerCase() === needle
  );
}

/** Treasury Safe — Rebater watches outflows from here. */
export function getTreasuryWatchAddress(): Address {
  return getSafeByRole('treasury').address;
}
