import { getAddress, type Address } from 'viem';
import {
  ALLOCATION_SAFE_ROLE,
  SENTINEL_SAFE_ROLE,
  getSafeByRole,
} from '@/lib/safe/config';

function roleListIncludesAddress(
  roleHolders: ReadonlyArray<string> | undefined,
  address: string
): boolean {
  if (!roleHolders?.length) return false;
  const target = getAddress(address).toLowerCase();
  return roleHolders.some((holder) => {
    try {
      return getAddress(holder).toLowerCase() === target;
    } catch {
      return false;
    }
  });
}

export function vaultUsesAllocatorSafe(
  allocators: ReadonlyArray<string> | undefined
): boolean {
  return roleListIncludesAddress(
    allocators,
    getSafeByRole(ALLOCATION_SAFE_ROLE).address
  );
}

export function vaultUsesSentinelSafe(
  sentinels: ReadonlyArray<string> | undefined
): boolean {
  return roleListIncludesAddress(
    sentinels,
    getSafeByRole(SENTINEL_SAFE_ROLE).address
  );
}

export function walletIsDirectRoleHolder(
  wallet: Address | string | undefined,
  roleHolders: ReadonlyArray<string> | undefined
): boolean {
  if (!wallet || !roleHolders?.length) return false;
  return roleListIncludesAddress(roleHolders, wallet);
}
