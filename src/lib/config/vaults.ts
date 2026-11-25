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
  /**
   * Test vaults: omitted from overview, catalog, monthly statements, and
   * default GET /api/vaults.
   */
  excludeFromBusinessViews?: boolean;
  /** When true, excluded from dashboard active-vault and user counts */
  inactive?: boolean;
  /** When true, hidden from sidebar vault list */
  excludeFromSidebar?: boolean;
}

const VAULT_USDC_PRIME = '0x89712980Cb434eF5aE4AB29349419eb976B0b496';
const VAULT_WETH_PRIME = '0xd6dcad2f7da91fbb27bda471540d9770c97a5a43';
const VAULT_CBBTC_PRIME = '0x99dcd0d75822ba398f13b2a8852b07c7e137ec70';
const VAULT_USDC_FRONTIER = '0x314fD07319ef645bA7D548915CCd91F4788A1839';
const VAULT_CBBTC_TEST = '0xB15a51F46a53CF7dBB378A459A552F342bC54815';
const VAULT_USDC_TEST = '0x7D09D53637c8A3511de0eF1509b8dC5C2108a0AD';

const vaultAddresses: VaultAddressConfig[] = [
  {
    address: VAULT_USDC_PRIME,
    chainId: BASE_CHAIN_ID,
    morphoVersion: 'v2',
    assetSymbol: 'USDC',
    listCategory: 'prime',
  },
  {
    address: VAULT_WETH_PRIME,
    chainId: BASE_CHAIN_ID,
    morphoVersion: 'v2',
    assetSymbol: 'WETH',
    listCategory: 'prime',
  },
  {
    address: VAULT_CBBTC_PRIME,
    chainId: BASE_CHAIN_ID,
    morphoVersion: 'v2',
    assetSymbol: 'cbBTC',
    listCategory: 'prime',
  },
  {
    address: VAULT_USDC_FRONTIER,
    chainId: BASE_CHAIN_ID,
    morphoVersion: 'v2',
    assetSymbol: 'USDC',
    listCategory: 'frontier',
  },
  {
    address: VAULT_CBBTC_TEST,
    chainId: BASE_CHAIN_ID,
    morphoVersion: 'v2',
    assetSymbol: 'cbBTC',
    listCategory: 'test',
    excludeFromBusinessViews: true,
  },
  {
    address: VAULT_USDC_TEST,
    chainId: BASE_CHAIN_ID,
    morphoVersion: 'v2',
    assetSymbol: 'USDC',
    listCategory: 'test',
    excludeFromBusinessViews: true,
  },
];

const vaultByAddress = new Map(
  vaultAddresses.map((vault) => [vault.address.toLowerCase(), vault])
);

export const getVaultByAddress = (address: string): VaultAddressConfig | undefined => {
  return vaultByAddress.get(address.toLowerCase());
};

export function getVaultAssetSymbol(address: string): VaultAssetSymbol | undefined {
  return getVaultByAddress(address)?.assetSymbol;
}

const CATEGORY_LABEL: Record<VaultCategory, string> = {
  prime: 'Prime',
  frontier: 'Frontier',
  vineyard: 'Vineyard',
  test: 'Test',
};

/** Fallback label when GraphQL / on-chain name is unavailable. */
export function getConfiguredVaultDisplayName(
  vault: Pick<VaultAddressConfig, 'assetSymbol' | 'listCategory'>
): string {
  const category = vault.listCategory ? CATEGORY_LABEL[vault.listCategory] : 'V2';
  return `Muscadine ${vault.assetSymbol} ${category}`;
}

/** Morpho / on-chain name, or `fallback` when that name is missing. */
export function vaultDisplayName(
  name: string | null | undefined,
  fallback = 'Unknown Vault'
): string {
  return name?.trim() || fallback;
}

/** In-app vault page, optionally a tab segment. */
export function getVaultPageHref(address: string, segment?: string): string {
  if (!segment) return `/vault/${address}`;
  return `/vault/${address}/${segment}`;
}

/** Vaults included in the catalog, monthly statements, and GET /api/vaults */
export const getVaultAddressesForBusinessViews = (): VaultAddressConfig[] => {
  return vaultAddresses.filter((v) => !v.excludeFromBusinessViews);
};

/** Business vaults counted in protocol TVL. */
export const getVaultAddressesForProtocolStats = (): VaultAddressConfig[] => {
  return getVaultAddressesForBusinessViews();
};

/**
 * Active business vaults for dashboard unique-user counts and the active-vault
 * KPI. Excludes test (`excludeFromBusinessViews`) and `inactive` vaults.
 */
export const getActiveVaultAddressesForStats = (): VaultAddressConfig[] => {
  return getVaultAddressesForBusinessViews().filter((v) => !v.inactive);
};

/** Vaults shown in the sidebar */
export const getSidebarVaultAddresses = (): VaultAddressConfig[] => {
  return vaultAddresses.filter((v) => !v.inactive && !v.excludeFromSidebar);
};

export type SidebarNavVault = {
  address: string;
  chainId: number;
  name: string;
};

/**
 * Swap each sidebar vault's configured fallback name for the Morpho / on-chain
 * name from the vault list, once that list has loaded. Missing or placeholder
 * names keep the fallback.
 */
export function withFetchedVaultNames<T extends { address: string; name: string }>(
  configured: readonly T[],
  fetched: ReadonlyArray<{ address: string; name?: string | null }> | undefined
): T[] {
  if (!fetched?.length) return [...configured];
  const byAddress = new Map(
    fetched.map((vault) => [vault.address.toLowerCase(), vault.name?.trim() ?? ''])
  );
  return configured.map((vault) => {
    const name = byAddress.get(vault.address.toLowerCase());
    if (!name || name === 'Unknown Vault') return vault;
    return { ...vault, name };
  });
}

/** Instant sidebar rows from config — no Morpho round-trip. */
export function getSidebarNavVaults(): SidebarNavVault[] {
  return getSidebarVaultAddresses().map((v) => ({
    address: v.address,
    chainId: v.chainId,
    name: getConfiguredVaultDisplayName(v),
  }));
}

/** All vault addresses including hidden vaults (e.g. test). */
export const getAllVaultAddresses = (): VaultAddressConfig[] => {
  return vaultAddresses;
};

/** Categorize vaults by config, else by name pattern. */
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

export const VAULT_LIST_CATEGORY_ORDER: readonly VaultCategory[] = [
  'prime',
  'frontier',
  'vineyard',
  'test',
];

export type VaultListCategoryGroup<T> = {
  category: VaultCategory;
  label: string;
  vaults: T[];
};

type GroupableVault = {
  name?: string | null;
  address: string;
};

/** List groups: Prime / Frontier / Vineyard / Test. Empty groups are dropped. */
export function groupVaultsByCategory<T extends GroupableVault>(
  vaults: readonly T[]
): VaultListCategoryGroup<T>[] {
  const groups: VaultListCategoryGroup<T>[] = [];
  for (const category of VAULT_LIST_CATEGORY_ORDER) {
    const matched = vaults.filter((v) => getVaultCategory(v.name, v.address) === category);
    if (matched.length === 0) continue;
    groups.push({ category, label: CATEGORY_LABEL[category], vaults: matched });
  }
  return groups;
}
