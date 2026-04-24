import { Address } from 'viem';
import { VAULT_ABI, safeContractRead } from './client';

// Vault roles interface
export interface VaultRoles {
  owner: Address | null;
  curator: Address | null;
  guardian: Address | null;
  timelock: Address | null;
}

// Read vault roles from contract (with fallback to null if not available)
export const readVaultRoles = async (vaultAddress: Address): Promise<VaultRoles> => {
  const [owner, curator, guardian, timelock] = await Promise.all([
    safeContractRead<Address>(vaultAddress, VAULT_ABI, 'owner'),
    safeContractRead<Address>(vaultAddress, VAULT_ABI, 'curator'),
    safeContractRead<Address>(vaultAddress, VAULT_ABI, 'guardian'),
    safeContractRead<Address>(vaultAddress, VAULT_ABI, 'timelock'),
  ]);

  return {
    owner,
    curator,
    guardian,
    timelock,
  };
};

// Read allocator addresses from contract
// MetaMorpho V1.1 uses a mapping, so we need to check known allocators or use events
// For now, we'll try to read from GraphQL API first, then fallback to checking known addresses
export const readVaultAllocators = async (vaultAddress: Address): Promise<Address[] | null> => {
  // Try different function names that might be used
  const allocators1 = await safeContractRead<Address[]>(vaultAddress, VAULT_ABI, 'allocators');
  if (allocators1) return allocators1;
  
  const allocators2 = await safeContractRead<Address[]>(vaultAddress, VAULT_ABI, 'getAllocators');
  if (allocators2) return allocators2;
  
  return null;
};

// Read pending guardian
export const readPendingGuardian = async (vaultAddress: Address): Promise<Address | null> => {
  return safeContractRead<Address>(vaultAddress, VAULT_ABI, 'pendingGuardian');
};
