// Simplified vault config - only stores addresses
// All other data (name, symbol, asset, performance fee, etc.) is fetched from GraphQL

import { BASE_CHAIN_ID } from '@/lib/constants';

export type VaultCategory = 'prime' | 'vineyard' | 'frontier' | 'test';

/** Underlying vault asset — used for calldata decode/formatting before GraphQL loads. */
export type VaultAssetSymbol = 'USDC' | 'WETH' | 'cbBTC';

export interface VaultAddressConfig {
  address: string;
  chainId: number;
  /** Morpho API schema version — all configured vaults are V2 */
  morphoVersion: 'v2';
  assetSymbol: VaultAssetSymbol;
  /** Overrides name-based UI routing when the Morpho vault name lacks category keywords */
  listCategory?: VaultCategory;
  /** When true, hidden from overview, protocol stats, monthly statements, and GET /api/vaults */
  excludeFromBusinessViews?: boolean;
  /** When true, excluded from dashboard active-vault and user counts */
  inactive?: boolean;
  /** When true, hidden from sidebar vault list */
  excludeFromSidebar?: boolean;
}

const vaultAddresses: VaultAddressConfig[] = [
  {
    address: process.env.NEXT_PUBLIC_VAULT_USDC_V2 || '0x89712980Cb434eF5aE4AB29349419eb976B0b496',
    chainId: BASE_CHAIN_ID,
    morphoVersion: 'v2',
    assetSymbol: 'USDC',
    listCategory: 'prime',
  },
  {
    address: process.env.NEXT_PUBLIC_VAULT_WETH_V2 || '0xd6dcad2f7da91fbb27bda471540d9770c97a5a43',
    chainId: BASE_CHAIN_ID,
    morphoVersion: 'v2',
    assetSymbol: 'WETH',
    listCategory: 'prime',
  },
  {
    address: process.env.NEXT_PUBLIC_VAULT_CBBTC_V2 || '0x99dcd0d75822ba398f13b2a8852b07c7e137ec70',
    chainId: BASE_CHAIN_ID,
    morphoVersion: 'v2',
    assetSymbol: 'cbBTC',
    listCategory: 'prime',
  },
  {
    address:
      process.env.NEXT_PUBLIC_VAULT_USDC_V2_FRONTIER ||
      '0x314fD07319ef645bA7D548915CCd91F4788A1839',
    chainId: BASE_CHAIN_ID,
    morphoVersion: 'v2',
    assetSymbol: 'USDC',
    listCategory: 'frontier',
  },
  {
    address:
      process.env.NEXT_PUBLIC_VAULT_CBBTC_V2_TEST ||
      '0xB15a51F46a53CF7dBB378A459A552F342bC54815',
    chainId: BASE_CHAIN_ID,
    morphoVersion: 'v2',
    assetSymbol: 'cbBTC',
    listCategory: 'test',
    excludeFromBusinessViews: true,
  },
];

export const getVaultByAddress = (address: string): VaultAddressConfig | undefined => {
  return vaultAddresses.find((vault) => vault.address.toLowerCase() === address.toLowerCase());
};

export function getVaultAssetSymbol(address: string): VaultAssetSymbol | undefined {
  return getVaultByAddress(address)?.assetSymbol;
}

/** Vaults included in overview, protocol stats, monthly statements, and the public vault list API */
export const getVaultAddressesForBusinessViews = (): VaultAddressConfig[] => {
  return vaultAddresses.filter((v) => !v.excludeFromBusinessViews);
};

/** Active vaults for dashboard user / active-vault counts (excludes test vaults). */
export const getActiveVaultAddressesForStats = (): VaultAddressConfig[] => {
  return getVaultAddressesForBusinessViews().filter((v) => !v.inactive);
};

/** Vaults shown in the sidebar */
export const getSidebarVaultAddresses = (): VaultAddressConfig[] => {
  return vaultAddresses.filter((v) => !v.inactive && !v.excludeFromSidebar);
};

/** All vault addresses including hidden vaults (e.g. test). */
export const getAllVaultAddresses = (): VaultAddressConfig[] => {
  return vaultAddresses;
};

/** Categorize vaults by config or name pattern (for wrapped MetaMorpho labels, etc.). */
export const getVaultCategory = (
  vaultName: string | null | undefined,
  vaultAddress?: string | null
): VaultCategory => {
  if (vaultAddress) {
    const cfg = getVaultByAddress(vaultAddress);
    if (cfg?.listCategory) return cfg.listCategory;
  }
  if (!vaultName) return 'prime';
  const name = vaultName.toLowerCase();
  if (name.includes('frontier')) return 'frontier';
  if (name.includes('prime')) return 'prime';
  if (name.includes('vineyard')) return 'vineyard';
  if (name.includes('test')) return 'test';
  return 'prime';
};
