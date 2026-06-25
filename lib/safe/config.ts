import type { Address } from 'viem';

export const SAFE_ROLES = ['owner', 'curator', 'allocator', 'sentinel', 'treasury'] as const;

export type SafeRole = (typeof SAFE_ROLES)[number];

export type SafeAccountConfig = {
  role: SafeRole;
  label: string;
  address: Address;
  description: string;
};

/** Muscadine vault-role Safes on Base (chainId 8453). */
export const SAFE_ACCOUNTS: ReadonlyArray<SafeAccountConfig> = [
  {
    role: 'owner',
    label: 'Owner',
    address: '0x4E5D3ef790C75682ac4f6d4C1dDCc08b36fC100A',
    description: 'Owner multisig',
  },
  {
    role: 'curator',
    label: 'Curator',
    address: '0xb6d1d784e9Bc3570546e231caCB52B4E0f1ED8b1',
    description: 'Curator multisig',
  },
  {
    role: 'allocator',
    label: 'Allocator',
    address: '0x2Ed45BB3542d06d81D117acd8A561e910A17A618',
    description: 'Allocator multisig — vault rebalances are queued here',
  },
  {
    role: 'sentinel',
    label: 'Sentinel',
    address: '0x64e804eEF4F5a53272A8623b563ad2724E98A0a9',
    description: 'Sentinel multisig',
  },
  {
    role: 'treasury',
    label: 'Treasury',
    address: '0x057fd8B961Eb664baA647a5C7A6e9728fabA266A',
    description: 'Treasury multisig',
  },
] as const;

/** Default Safe tab when allocation writes are queued. */
export const ALLOCATION_SAFE_ROLE: SafeRole = 'allocator';

/** Safe that signs vault sentinel writes (cap decreases, deallocate). */
export const SENTINEL_SAFE_ROLE: SafeRole = 'sentinel';

export function isSafeRole(value: string): value is SafeRole {
  return (SAFE_ROLES as ReadonlyArray<string>).includes(value);
}

export function getSafeByRole(role: SafeRole): SafeAccountConfig {
  const account = SAFE_ACCOUNTS.find((s) => s.role === role);
  if (!account) throw new Error(`Unknown Safe role: ${role}`);
  return account;
}

export function getSafeByAddress(address: string): SafeAccountConfig | undefined {
  const normalized = address.toLowerCase();
  return SAFE_ACCOUNTS.find((s) => s.address.toLowerCase() === normalized);
}
