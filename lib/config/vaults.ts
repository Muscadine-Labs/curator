// Simplified vault config - only stores addresses
// All other data (name, symbol, asset, performance fee, etc.) is fetched from GraphQL

export type VaultCategory = 'prime' | 'vineyard' | 'v1';

export interface VaultAddressConfig {
  address: string;
  chainId: number;
  /** Overrides name-based UI routing when the Morpho vault name lacks "Prime" / "Vineyard" */
  listCategory?: VaultCategory;
  /** When true, hidden from overview, protocol stats, monthly statements, and GET /api/vaults (direct /vault/... still works) */
  excludeFromBusinessViews?: boolean;
}

export interface RoleConfig {
  owner: string;
  guardian: string;
  curator: string;
  allocators: {
    name: string;
    address: string;
    type: 'public' | 'private';
  }[];
}

import { BASE_CHAIN_ID, BASE_CHAIN_NAME } from '@/lib/constants';

/**
 * Chain IDs for reference:
 * - Ethereum: 1
 * - Base: 8453
 */

export interface ProtocolConfig {
  chainId: number;
  chainName: string;
  roles: RoleConfig;
}

// Vault addresses only - all other data fetched from GraphQL
export const vaultAddresses: VaultAddressConfig[] = [
  // V2 Prime Vaults
  {
    address: process.env.NEXT_PUBLIC_VAULT_USDC_V2 || '0x89712980Cb434eF5aE4AB29349419eb976B0b496',
    chainId: BASE_CHAIN_ID,
  },
  {
    address: process.env.NEXT_PUBLIC_VAULT_WETH_V2 || '0xd6dcad2f7da91fbb27bda471540d9770c97a5a43',
    chainId: BASE_CHAIN_ID,
  },
  {
    address: process.env.NEXT_PUBLIC_VAULT_CBBTC_V2 || '0x99dcd0d75822ba398f13b2a8852b07c7e137ec70',
    chainId: BASE_CHAIN_ID,
  },
  {
    address:
      process.env.NEXT_PUBLIC_VAULT_CBBTC_V2_TEST ||
      '0xB15a51F46a53CF7dBB378A459A552F342bC54815',
    chainId: BASE_CHAIN_ID,
    listCategory: 'prime',
    excludeFromBusinessViews: true,
  },
  // V1 Vaults
  {
    address: process.env.NEXT_PUBLIC_VAULT_USDC || '0xf7e26Fa48A568b8b0038e104DfD8ABdf0f99074F',
    chainId: BASE_CHAIN_ID,
  },
  {
    address: process.env.NEXT_PUBLIC_VAULT_CBBTC || '0xAeCc8113a7bD0CFAF7000EA7A31afFD4691ff3E9',
    chainId: BASE_CHAIN_ID,
  },
  {
    address: process.env.NEXT_PUBLIC_VAULT_WETH || '0x21e0d366272798da3A977FEBA699FCB91959d120',
    chainId: BASE_CHAIN_ID,
  },
];

// Protocol configuration
export const protocolConfig: ProtocolConfig = {
  chainId: BASE_CHAIN_ID,
  chainName: BASE_CHAIN_NAME,
  roles: {
    owner: process.env.NEXT_PUBLIC_ROLE_OWNER || '0x4E5D3ef790C75682ac4f6d4C1dDCc08b36fC100A',
    guardian: process.env.NEXT_PUBLIC_ROLE_GUARDIAN || '0x64e804eEF4F5a53272A8623b563ad2724E98A0a9',
    curator: process.env.NEXT_PUBLIC_ROLE_CURATOR || '0xb6d1d784e9Bc3570546e231caCB52B4E0f1ED8b1',
    allocators: [
      {
        name: 'Public Allocator (Morpho SC)',
        address: '0x0000000000000000000000000000000000000000',
        type: 'public'
      },
      {
        name: 'Muscadine Hot Wallet',
        address: process.env.NEXT_PUBLIC_ALLOCATOR_HOT || '0xf35B121bA32cBeaA27716abEfFb6B65a55f9B333',
        type: 'private'
      },
      {
        name: 'Ignas Smart Wallet',
        address: process.env.NEXT_PUBLIC_ALLOCATOR_IGNAS || '0x0D5A708B651FeE1DAA0470431c4262ab3e1D0261',
        type: 'private'
      }
    ]
  }
};

// Helper functions
export const getVaultByAddress = (address: string): VaultAddressConfig | undefined => {
  return vaultAddresses.find(vault => vault.address.toLowerCase() === address.toLowerCase());
};

export const getAllVaultAddresses = (): VaultAddressConfig[] => {
  return vaultAddresses;
};

/** Vaults included in overview, protocol stats, monthly statements, and the public vault list API */
export const getVaultAddressesForBusinessViews = (): VaultAddressConfig[] => {
  return vaultAddresses.filter((v) => !v.excludeFromBusinessViews);
};

// Categorize vaults by name pattern (works with GraphQL data); optional address uses listCategory from config
export const getVaultCategory = (
  vaultName: string | null | undefined,
  vaultAddress?: string | null
): VaultCategory => {
  if (vaultAddress) {
    const cfg = getVaultByAddress(vaultAddress);
    if (cfg?.listCategory) return cfg.listCategory;
  }
  if (!vaultName) {
    return 'v1'; // Default to v1 if name is missing
  }
  const name = vaultName.toLowerCase();
  if (name.includes('prime')) {
    return 'prime';
  }
  if (name.includes('vineyard')) {
    return 'vineyard';
  }
  return 'v1';
};

// Determine if vault should use v2 GraphQL query (Prime and Vineyard are both v2)
export const shouldUseV2Query = (
  vaultName: string | null | undefined,
  vaultAddress?: string | null
): boolean => {
  const category = getVaultCategory(vaultName, vaultAddress);
  return category === 'prime' || category === 'vineyard';
};
