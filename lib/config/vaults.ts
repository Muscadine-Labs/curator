// Simplified vault config - only stores addresses
// All other data (name, symbol, asset, performance fee, etc.) is fetched from GraphQL

import { BASE_CHAIN_ID } from '@/lib/constants';

export type VaultCategory = 'prime' | 'vineyard' | 'frontier' | 'test';

/**
 * `strategy` — allocates to Morpho Blue markets (MorphoMarketV1Adapter).
 * `feeWrapper` — single MorphoVaultV2Adapter into another Vault V2 (empty allocate data).
 */
export type VaultKind = 'strategy' | 'feeWrapper';

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
  /** Default `strategy`. Fee wrappers only allocate to one underlying Vault V2. */
  kind?: VaultKind;
  /**
   * Child Vault V2 when `kind` is `feeWrapper`. Same env default as the
   * strategy vault (e.g. `NEXT_PUBLIC_VAULT_USDC_V2`). GraphQL fallback when
   * Morpho `MorphoVaultV2Adapter.innerVault` is omitted.
   */
  underlyingAddress?: string;
  /**
   * MorphoVaultV2Adapter that deposits into the underlying vault. The adapter
   * — not the wrapper vault contract — is the ERC-4626 holder of the child.
   */
  adapterAddress?: string;
  /**
   * Test vaults: omitted from overview, catalog, monthly statements, and
   * default GET /api/vaults. Not the TVL double-count flag — use
   * `kind: 'feeWrapper'` so wrappers stay in business views.
   */
  excludeFromBusinessViews?: boolean;
  /** When true, excluded from dashboard active-vault and user counts */
  inactive?: boolean;
  /** When true, hidden from sidebar vault list */
  excludeFromSidebar?: boolean;
}

const VAULT_USDC_PRIME =
  process.env.NEXT_PUBLIC_VAULT_USDC_V2 || '0x89712980Cb434eF5aE4AB29349419eb976B0b496';
const VAULT_WETH_PRIME =
  process.env.NEXT_PUBLIC_VAULT_WETH_V2 || '0xd6dcad2f7da91fbb27bda471540d9770c97a5a43';
const VAULT_CBBTC_PRIME =
  process.env.NEXT_PUBLIC_VAULT_CBBTC_V2 || '0x99dcd0d75822ba398f13b2a8852b07c7e137ec70';
const VAULT_USDC_FRONTIER =
  process.env.NEXT_PUBLIC_VAULT_USDC_V2_FRONTIER ||
  '0x314fD07319ef645bA7D548915CCd91F4788A1839';
const VAULT_CBBTC_TEST =
  process.env.NEXT_PUBLIC_VAULT_CBBTC_V2_TEST ||
  '0xB15a51F46a53CF7dBB378A459A552F342bC54815';
const VAULT_USDC_TEST =
  process.env.NEXT_PUBLIC_VAULT_USDC_V2_TEST ||
  '0x7D09D53637c8A3511de0eF1509b8dC5C2108a0AD';

/** MorphoVaultV2Adapter for each fee wrapper (holder of the underlying vault). */
const ADAPTER_USDC_PRIME_WRAPPER = '0x8B6E43CCE1961D3671a39Fe8D9E711E69ddD74ce';
const ADAPTER_USDC_FRONTIER_WRAPPER = '0x5b211DA4Cd92cfb9CCCFbd1De78289955EB236CD';
const ADAPTER_WETH_PRIME_WRAPPER = '0xf691616Dd2cF85c9cA9fa32bdFf00f5cD92BAd81';
const ADAPTER_CBBTC_PRIME_WRAPPER = '0xa3b90423FD6f70B9f4A424dEBfB27ac502ac1464';
const ADAPTER_USDC_TEST_WRAPPER = '0x5167D22911b948AD7011E50D86dE98E14391A0E4';

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
  {
    address:
      process.env.NEXT_PUBLIC_VAULT_USDC_PRIME_WRAPPER ||
      '0x036A01eFdDC87F6634FFDE0533EE528b90fc7A45',
    chainId: BASE_CHAIN_ID,
    morphoVersion: 'v2',
    assetSymbol: 'USDC',
    listCategory: 'prime',
    kind: 'feeWrapper',
    underlyingAddress: VAULT_USDC_PRIME,
    adapterAddress: ADAPTER_USDC_PRIME_WRAPPER,
  },
  {
    address:
      process.env.NEXT_PUBLIC_VAULT_USDC_FRONTIER_WRAPPER ||
      '0x54D8417bD21C86A7806b58f5aa2e2E0bB88B856A',
    chainId: BASE_CHAIN_ID,
    morphoVersion: 'v2',
    assetSymbol: 'USDC',
    listCategory: 'frontier',
    kind: 'feeWrapper',
    underlyingAddress: VAULT_USDC_FRONTIER,
    adapterAddress: ADAPTER_USDC_FRONTIER_WRAPPER,
  },
  {
    address:
      process.env.NEXT_PUBLIC_VAULT_WETH_PRIME_WRAPPER ||
      '0x548653b09b03A69f93B3890c382fE9DcD245cbc4',
    chainId: BASE_CHAIN_ID,
    morphoVersion: 'v2',
    assetSymbol: 'WETH',
    listCategory: 'prime',
    kind: 'feeWrapper',
    underlyingAddress: VAULT_WETH_PRIME,
    adapterAddress: ADAPTER_WETH_PRIME_WRAPPER,
  },
  {
    address:
      process.env.NEXT_PUBLIC_VAULT_CBBTC_PRIME_WRAPPER ||
      '0x0e0a857d2AF1A2d43c82d1FA54766239CAb70147',
    chainId: BASE_CHAIN_ID,
    morphoVersion: 'v2',
    assetSymbol: 'cbBTC',
    listCategory: 'prime',
    kind: 'feeWrapper',
    underlyingAddress: VAULT_CBBTC_PRIME,
    adapterAddress: ADAPTER_CBBTC_PRIME_WRAPPER,
  },
  {
    address:
      process.env.NEXT_PUBLIC_VAULT_USDC_TEST_WRAPPER ||
      '0x9efdc9986052e058ef717c02d500Ca0456d8c1cb',
    chainId: BASE_CHAIN_ID,
    morphoVersion: 'v2',
    assetSymbol: 'USDC',
    listCategory: 'test',
    kind: 'feeWrapper',
    underlyingAddress: VAULT_USDC_TEST,
    adapterAddress: ADAPTER_USDC_TEST_WRAPPER,
    excludeFromBusinessViews: true,
  },
];

const vaultByAddress = new Map(
  vaultAddresses.map((vault) => [vault.address.toLowerCase(), vault])
);

const vaultByAdapterAddress = new Map<string, VaultAddressConfig>();
for (const vault of vaultAddresses) {
  if (vault.adapterAddress) {
    vaultByAdapterAddress.set(vault.adapterAddress.toLowerCase(), vault);
  }
}

export const getVaultByAddress = (address: string): VaultAddressConfig | undefined => {
  return vaultByAddress.get(address.toLowerCase());
};

/** Fee wrapper whose MorphoVaultV2Adapter matches this address. */
export const getVaultByAdapterAddress = (
  address: string
): VaultAddressConfig | undefined => {
  return vaultByAdapterAddress.get(address.toLowerCase());
};

/** True for MorphoVaultV2Adapter contracts that hold the underlying vault. */
export function isFeeWrapperAdapterAddress(address: string): boolean {
  return vaultByAdapterAddress.has(address.toLowerCase());
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

export function isFeeWrapperVault(
  vault: { kind?: VaultKind | null } | null | undefined
): boolean {
  return vault?.kind === 'feeWrapper';
}

/**
 * Fallback label when GraphQL / on-chain name is unavailable.
 * Fee wrappers match Morpho names (`USDC Prime`) plus ` (wrapper)`;
 * strategy vaults keep the Muscadine prefix (`Muscadine USDC Prime`).
 */
export function getConfiguredVaultDisplayName(
  vault: Pick<VaultAddressConfig, 'assetSymbol' | 'listCategory' | 'kind'>
): string {
  const category = vault.listCategory ? CATEGORY_LABEL[vault.listCategory] : 'V2';
  if (vault.kind === 'feeWrapper') {
    return `${vault.assetSymbol} ${category} (wrapper)`;
  }
  return `Muscadine ${vault.assetSymbol} ${category}`;
}

const WRAPPER_SUFFIX_RE = /\(\s*wrapper\s*\)\s*$/i;

/** Append ` (wrapper)` for fee-wrapper addresses. Idempotent. */
export function withFeeWrapperLabel(
  name: string | null | undefined,
  address: string | null | undefined,
  fallback = 'Unknown Vault'
): string {
  const base = name?.trim() || fallback;
  if (!address) return base;
  if (getVaultByAddress(address)?.kind !== 'feeWrapper') return base;
  if (WRAPPER_SUFFIX_RE.test(base)) return base;
  return `${base} (wrapper)`;
}

/** GraphQL `innerVault.address`, else the wrapper's configured underlying vault. */
export function resolveUnderlyingVaultAddress(
  wrapperAddress: string,
  graphQlAddress?: string | null
): string | null {
  if (graphQlAddress) return graphQlAddress;
  return getVaultByAddress(wrapperAddress)?.underlyingAddress ?? null;
}

/** Fee wrapper immutably bound to this strategy vault, if any. */
export function getFeeWrapperForUnderlying(
  underlyingAddress: string
): VaultAddressConfig | undefined {
  const key = underlyingAddress.toLowerCase();
  return vaultAddresses.find(
    (v) => v.kind === 'feeWrapper' && v.underlyingAddress?.toLowerCase() === key
  );
}

/**
 * Canonical vault page. Fee-wrapper contracts redirect onto the underlying
 * vault's Fee wrapper tab instead of existing as a peer vault page.
 */
export function getVaultPageHref(
  address: string,
  segment?: string
): string {
  const cfg = getVaultByAddress(address);
  if (cfg?.kind === 'feeWrapper' && cfg.underlyingAddress) {
    return `/vault/${cfg.underlyingAddress}/fee-wrapper`;
  }
  if (!segment) return `/vault/${address}`;
  return `/vault/${address}/${segment}`;
}

/** Vaults included in the catalog, monthly statements, and GET /api/vaults */
export const getVaultAddressesForBusinessViews = (): VaultAddressConfig[] => {
  return vaultAddresses.filter((v) => !v.excludeFromBusinessViews);
};

/**
 * Strategy vaults for protocol TVL. Fee wrappers deposit into underlying vaults —
 * summing both would double-count. Unique users use
 * `getActiveVaultAddressesForStats` (includes wrappers; adapter contracts
 * that hold the underlying are then skipped).
 */
export const getVaultAddressesForProtocolStats = (): VaultAddressConfig[] => {
  return getVaultAddressesForBusinessViews().filter((v) => v.kind !== 'feeWrapper');
};

/**
 * Active business vaults for dashboard unique-user counts and the active-vault
 * KPI. Includes fee wrappers so wrapper-only depositors are counted; excludes
 * test (`excludeFromBusinessViews`) and `inactive` vaults. Wrapper adapters
 * are stripped from the user set in protocol-stats / protocol-users.
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
  kind: VaultKind;
};

/**
 * Instant sidebar rows from config — no Morpho round-trip.
 * Fee wrappers are omitted; they live on the underlying vault's Fee wrapper tab.
 */
export function getSidebarNavVaults(): SidebarNavVault[] {
  return getSidebarVaultAddresses()
    .filter((v) => v.kind !== 'feeWrapper')
    .map((v) => ({
      address: v.address,
      chainId: v.chainId,
      name: getConfiguredVaultDisplayName(v),
      kind: v.kind ?? 'strategy',
    }));
}

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

export const VAULT_LIST_KIND_ORDER = ['underlying', 'wrapper'] as const;
export type VaultListKind = (typeof VAULT_LIST_KIND_ORDER)[number];

export const VAULT_LIST_KIND_LABEL: Record<VaultListKind, string> = {
  underlying: 'Underlying',
  wrapper: 'Wrapper',
};

export const VAULT_LIST_CATEGORY_ORDER: readonly VaultCategory[] = [
  'prime',
  'frontier',
  'vineyard',
  'test',
];

export function getVaultListKind(
  vault: { kind?: VaultKind | null } | null | undefined
): VaultListKind {
  return isFeeWrapperVault(vault) ? 'wrapper' : 'underlying';
}

export type VaultListCategoryGroup<T> = {
  category: VaultCategory;
  label: string;
  vaults: T[];
};

export type VaultListKindGroup<T> = {
  kind: VaultListKind;
  label: string;
  categories: VaultListCategoryGroup<T>[];
};

type GroupableVault = {
  kind?: VaultKind | null;
  name?: string | null;
  address: string;
};

/** Nested list groups: Underlying / Wrapper, then Prime / Frontier / Test. */
export function groupVaultsByKindAndCategory<T extends GroupableVault>(
  vaults: readonly T[]
): VaultListKindGroup<T>[] {
  const groups: VaultListKindGroup<T>[] = [];
  for (const kind of VAULT_LIST_KIND_ORDER) {
    const ofKind = vaults.filter((v) => getVaultListKind(v) === kind);
    if (ofKind.length === 0) continue;
    const categories: VaultListCategoryGroup<T>[] = [];
    for (const category of VAULT_LIST_CATEGORY_ORDER) {
      const matched = ofKind.filter(
        (v) => getVaultCategory(v.name, v.address) === category
      );
      if (matched.length === 0) continue;
      categories.push({
        category,
        label: CATEGORY_LABEL[category],
        vaults: matched,
      });
    }
    if (categories.length === 0) continue;
    groups.push({
      kind,
      label: VAULT_LIST_KIND_LABEL[kind],
      categories,
    });
  }
  return groups;
}
