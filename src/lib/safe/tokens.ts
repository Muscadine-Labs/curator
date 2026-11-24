import { getAddress, isAddress, type Address } from 'viem';
import {
  BASE_CBBTC_ADDRESS,
  BASE_USDC_ADDRESS,
  BASE_WETH_ADDRESS,
} from '@/lib/constants';
import { getAllVaultAddresses, getConfiguredVaultDisplayName } from '@/lib/config/vaults';

/** Sentinel `address` for the chain's native asset — never a real ERC-20. */
export const NATIVE_TOKEN_ADDRESS = 'native' as const;

/**
 * Fraction digits for Safe balances. Deliberately higher than the app-wide
 * default of 2: a Safe's ETH gas float and leftover vault-share dust both round
 * to `0.00` at two places, which reads as an empty Safe.
 */
export const SAFE_AMOUNT_DP = 6;

export type SafeTokenAddress = Address | typeof NATIVE_TOKEN_ADDRESS;

export type SafeTokenMeta = {
  address: SafeTokenAddress;
  symbol: string;
  name: string;
  decimals: number;
  /** Vault shares are ERC-4626 receipts, shown apart from plain holdings. */
  kind: 'native' | 'erc20' | 'vaultShare';
};

/** Type guard so the ERC-20 branches narrow to a real `Address`. */
export function isNativeToken(
  address: SafeTokenAddress
): address is typeof NATIVE_TOKEN_ADDRESS {
  return address === NATIVE_TOKEN_ADDRESS;
}

const BASE_ASSETS: ReadonlyArray<SafeTokenMeta> = [
  {
    address: NATIVE_TOKEN_ADDRESS,
    symbol: 'ETH',
    name: 'Ether',
    decimals: 18,
    kind: 'native',
  },
  {
    address: getAddress(BASE_USDC_ADDRESS),
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    kind: 'erc20',
  },
  {
    address: getAddress(BASE_WETH_ADDRESS),
    symbol: 'WETH',
    name: 'Wrapped Ether',
    decimals: 18,
    kind: 'erc20',
  },
  {
    address: getAddress(BASE_CBBTC_ADDRESS),
    symbol: 'cbBTC',
    name: 'Coinbase Wrapped BTC',
    decimals: 8,
    kind: 'erc20',
  },
];

/**
 * Tokens a Muscadine Safe is expected to hold: native ETH, the three Base
 * assets the vaults denominate in, and every configured vault's shares (a Safe
 * that seeded or holds fee-wrapper shares shows them here). Anything else has
 * to be added by address — Safes can receive arbitrary tokens, and enumerating
 * them on-chain is not possible without an indexer.
 */
export function getDefaultSafeTokens(): SafeTokenMeta[] {
  const vaultShares = getAllVaultAddresses().map<SafeTokenMeta>((vault) => ({
    address: getAddress(vault.address),
    // Several vaults share an asset, so the vault name — not the asset — is
    // what tells two share balances apart in a list or a send picker.
    symbol: getConfiguredVaultDisplayName(vault),
    name: `${vault.assetSymbol} vault shares`,
    // ERC-4626 vault shares are 18 decimals regardless of the underlying asset.
    decimals: 18,
    kind: 'vaultShare',
  }));

  return [...BASE_ASSETS, ...vaultShares];
}

/**
 * Extra tokens accepted per request. Each one costs four multicall entries, so
 * an unbounded list would let a single request build an enormous RPC payload.
 */
export const MAX_EXTRA_TOKENS = 50;

/** Parse `?tokens=0xabc,0xdef` into checksummed addresses, ignoring junk. */
export function parseExtraTokenParam(raw: string | null): Address[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: Address[] = [];
  for (const part of raw.split(',')) {
    if (out.length >= MAX_EXTRA_TOKENS) break;
    const value = part.trim();
    if (!isAddress(value)) continue;
    const address = getAddress(value);
    if (seen.has(address.toLowerCase())) continue;
    seen.add(address.toLowerCase());
    out.push(address);
  }
  return out;
}
