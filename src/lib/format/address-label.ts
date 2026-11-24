import type { Address } from 'viem';
import { isVaultV2PublicAllocatorAddress } from '@/lib/constants/bots';
import {
  getConfiguredVaultDisplayName,
  getVaultByAdapterAddress,
  getVaultByAddress,
} from '@/lib/config/vaults';
import { getSafeByAddress } from '@/lib/safe/config';

export type RoleAddressKind = 'public_allocator' | 'safe' | 'eoa';

export type RoleAddressInfo = {
  address: string;
  label: string;
  kind: RoleAddressKind;
  /** Safe role when kind === 'safe'. */
  safeRole?: string;
};

export type BotActorKind =
  | 'allocator_safe'
  | 'sentinel_safe'
  | 'owner_safe'
  | 'curator_safe'
  | 'treasury_safe'
  | 'public_allocator'
  | 'other';

export type BotActorInfo = {
  address: Address;
  label: string;
  kind: BotActorKind;
};

export type DepositorKind = 'treasury' | 'fee_wrapper' | 'vault' | 'safe';

export type DepositorLabel = {
  address: string;
  label: string;
  kind: DepositorKind;
};

/**
 * Label vault role holders:
 * Public Allocator → known Muscadine Safes → EOA (unknown address).
 * Unknown addresses are labeled EOA for Roles UI (Muscadine role holders that
 * are not a known Safe or the Public Allocator are wallet keys in practice).
 */
export function resolveRoleAddress(address: string): RoleAddressInfo {
  if (isVaultV2PublicAllocatorAddress(address)) {
    return {
      address,
      label: 'Public Allocator',
      kind: 'public_allocator',
    };
  }

  const safe = getSafeByAddress(address);
  if (safe) {
    return {
      address: safe.address,
      label: `${safe.label} Safe`,
      kind: 'safe',
      safeRole: safe.role,
    };
  }

  return {
    address,
    label: 'EOA',
    kind: 'eoa',
  };
}

/** Human label for vault Roles UI (`AddressBadge` with `label="auto"`). */
export function getRoleAddressLabel(address: string): string {
  return resolveRoleAddress(address).label;
}

/**
 * Label known protocol addresses in depositor / holder / tx-user lists.
 * Vaults, then MorphoVaultV2Adapter contracts (the wrapper's deposit into the
 * underlying vault), then Safes. Returns null for ordinary wallets.
 */
export function resolveDepositorLabel(address: string): DepositorLabel | null {
  const vault = getVaultByAddress(address);
  if (vault) {
    return {
      address: vault.address,
      label: getConfiguredVaultDisplayName(vault),
      kind: vault.kind === 'feeWrapper' ? 'fee_wrapper' : 'vault',
    };
  }

  const wrapperByAdapter = getVaultByAdapterAddress(address);
  if (wrapperByAdapter) {
    return {
      address: wrapperByAdapter.adapterAddress as string,
      label: getConfiguredVaultDisplayName(wrapperByAdapter),
      kind: 'fee_wrapper',
    };
  }

  const safe = getSafeByAddress(address);
  if (safe) {
    return {
      address: safe.address,
      label: safe.role === 'treasury' ? 'Treasury' : `${safe.label} Safe`,
      kind: safe.role === 'treasury' ? 'treasury' : 'safe',
    };
  }

  return null;
}

export function getDepositorLabel(address: string): string | null {
  return resolveDepositorLabel(address)?.label ?? null;
}

function shortAddressLabel(address: string): string {
  if (address.length < 10) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** Resolve a watcher / tx-from address for bot activity UI. */
export function labelForActor(address: string): BotActorInfo {
  const resolved = resolveRoleAddress(address);

  if (resolved.kind === 'public_allocator') {
    return {
      address: address as Address,
      label: resolved.label,
      kind: 'public_allocator',
    };
  }

  if (resolved.kind === 'safe') {
    const role = resolved.safeRole;
    const kind: BotActorKind =
      role === 'allocator'
        ? 'allocator_safe'
        : role === 'sentinel'
          ? 'sentinel_safe'
          : role === 'owner'
            ? 'owner_safe'
            : role === 'curator'
              ? 'curator_safe'
              : role === 'treasury'
                ? 'treasury_safe'
                : 'other';
    return {
      address: resolved.address as Address,
      label: resolved.label,
      kind,
    };
  }

  return {
    address: address as Address,
    label: shortAddressLabel(address),
    kind: 'other',
  };
}
