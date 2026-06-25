import { getAddress, type Address } from 'viem';
import {
  ALLOCATION_SAFE_ROLE,
  SENTINEL_SAFE_ROLE,
  getSafeByRole,
} from '@/lib/safe/config';

export type VaultWriteMode = 'wallet' | 'safe' | 'both';

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

/** How the preview dialog should offer vault writes for this vault + wallet. */
export function resolveAllocationWriteMode(
  allocators: ReadonlyArray<string> | undefined,
  wallet: Address | string | undefined
): VaultWriteMode {
  const usesSafe = vaultUsesAllocatorSafe(allocators);
  const walletIsAllocator = walletIsDirectRoleHolder(wallet, allocators);

  if (usesSafe && !walletIsAllocator) return 'safe';
  if (walletIsAllocator && !usesSafe) return 'wallet';
  if (usesSafe) return 'safe';
  return 'both';
}

export function resolveSentinelWriteMode(
  sentinels: ReadonlyArray<string> | undefined,
  wallet: Address | string | undefined
): VaultWriteMode {
  const usesSafe = vaultUsesSentinelSafe(sentinels);
  const walletIsSentinel = walletIsDirectRoleHolder(wallet, sentinels);

  if (usesSafe && !walletIsSentinel) return 'safe';
  if (walletIsSentinel && !usesSafe) return 'wallet';
  if (usesSafe) return 'safe';
  return 'both';
}

export const SAFE_QUEUE_FOOTNOTE =
  'This vault’s on-chain role is a multisig Safe. Queue the proposal, then sign and execute on the Multisig Safe page with your owner hot wallet.';
