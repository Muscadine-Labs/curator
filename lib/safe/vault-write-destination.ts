import type { Address } from 'viem';
import {
  ALLOCATION_SAFE_ROLE,
  SENTINEL_SAFE_ROLE,
  getSafeByRole,
  type SafeRole,
} from '@/lib/safe/config';
import {
  vaultUsesAllocatorSafe,
  vaultUsesSentinelSafe,
  walletIsDirectRoleHolder,
} from '@/lib/safe/vault-role-match';

export type VaultWriteDestination =
  | { kind: 'wallet' }
  | { kind: 'safe'; role: SafeRole };

/** Role Safes that may appear in allocation / sentinel queue dropdowns. */
export const VAULT_WRITE_QUEUE_SAFE_ROLES: SafeRole[] = [
  'allocator',
  'curator',
  'owner',
  'sentinel',
];

/** Safes whose on-chain address holds a vault role (allocator or sentinel). */
export function eligibleSafeRolesForAddresses(
  roleHolders: ReadonlyArray<string> | undefined
): SafeRole[] {
  if (!roleHolders?.length) return [];
  return VAULT_WRITE_QUEUE_SAFE_ROLES.filter((role) =>
    walletIsDirectRoleHolder(getSafeByRole(role).address, roleHolders)
  );
}

function defaultSafeDestination(
  eligible: ReadonlyArray<SafeRole>,
  preferred: SafeRole
): VaultWriteDestination {
  const role = eligible.includes(preferred) ? preferred : eligible[0] ?? preferred;
  return { kind: 'safe', role };
}

export function defaultAllocationDestination(
  allocators: ReadonlyArray<string> | undefined,
  wallet: Address | string | undefined
): VaultWriteDestination {
  if (walletIsDirectRoleHolder(wallet, allocators)) {
    return { kind: 'wallet' };
  }
  const eligible = eligibleSafeRolesForAddresses(allocators);
  if (eligible.length > 0) {
    return defaultSafeDestination(eligible, ALLOCATION_SAFE_ROLE);
  }
  if (vaultUsesAllocatorSafe(allocators)) {
    return { kind: 'safe', role: ALLOCATION_SAFE_ROLE };
  }
  return { kind: 'safe', role: ALLOCATION_SAFE_ROLE };
}

export function defaultSentinelDestination(
  sentinels: ReadonlyArray<string> | undefined,
  wallet: Address | string | undefined
): VaultWriteDestination {
  if (walletIsDirectRoleHolder(wallet, sentinels)) {
    return { kind: 'wallet' };
  }
  const eligible = eligibleSafeRolesForAddresses(sentinels);
  if (eligible.length > 0) {
    return defaultSafeDestination(eligible, SENTINEL_SAFE_ROLE);
  }
  if (vaultUsesSentinelSafe(sentinels)) {
    return { kind: 'safe', role: SENTINEL_SAFE_ROLE };
  }
  return { kind: 'safe', role: SENTINEL_SAFE_ROLE };
}

/** After timelock, anyone may execute — default queue target is Allocator Safe. */
export function defaultPendingAcceptDestination(): VaultWriteDestination {
  return { kind: 'safe', role: ALLOCATION_SAFE_ROLE };
}

export function walletCanSignAllocation(
  wallet: Address | string | undefined,
  allocators: ReadonlyArray<string> | undefined
): boolean {
  return walletIsDirectRoleHolder(wallet, allocators);
}

export function walletCanSignSentinel(
  wallet: Address | string | undefined,
  sentinels: ReadonlyArray<string> | undefined
): boolean {
  return walletIsDirectRoleHolder(wallet, sentinels);
}

export function queueSafeOptions(
  roles: ReadonlyArray<SafeRole> = VAULT_WRITE_QUEUE_SAFE_ROLES
): Array<{ role: SafeRole; label: string; description: string }> {
  return roles.map((role) => {
    const cfg = getSafeByRole(role);
    return { role, label: cfg.label, description: cfg.description };
  });
}

export function confirmLabelForDestination(destination: VaultWriteDestination): string {
  if (destination.kind === 'wallet') {
    return 'Confirm & sign';
  }
  return `Queue in ${getSafeByRole(destination.role).label} Safe`;
}

export function loadingLabelForDestination(destination: VaultWriteDestination): string {
  if (destination.kind === 'wallet') {
    return 'Confirming…';
  }
  return 'Queuing…';
}

/** Coerce invalid Safe role picks; never override an explicit wallet selection. */
export function coerceVaultWriteDestination(
  destination: VaultWriteDestination,
  options: {
    eligibleSafeRoles: ReadonlyArray<SafeRole>;
    preferredSafeRole: SafeRole;
  }
): VaultWriteDestination {
  if (destination.kind === 'wallet') {
    return destination;
  }

  if (options.eligibleSafeRoles.includes(destination.role)) {
    return destination;
  }
  if (options.eligibleSafeRoles.length > 0) {
    return defaultSafeDestination(options.eligibleSafeRoles, options.preferredSafeRole);
  }
  return destination;
}

export function canConfirmVaultWriteDestination(
  destination: VaultWriteDestination,
  options: {
    walletReady: boolean;
    eligibleSafeRoles: ReadonlyArray<SafeRole>;
  }
): boolean {
  if (destination.kind === 'wallet') {
    return options.walletReady;
  }
  return options.eligibleSafeRoles.includes(destination.role);
}
