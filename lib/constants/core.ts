/**
 * Network, API, and timing constants used across the app.
 */

export const ETHEREUM_CHAIN_ID = 1;
export const BASE_CHAIN_ID = 8453;
/** HyperEVM (Hyperliquid) — Morpho chain id 999 */
export const HYPEREVM_CHAIN_ID = 999;

export const CURATOR_MARKET_NETWORKS = [
  { chainId: BASE_CHAIN_ID, name: 'Base', morphoSlug: 'base' },
  { chainId: ETHEREUM_CHAIN_ID, name: 'Ethereum', morphoSlug: 'ethereum' },
  { chainId: HYPEREVM_CHAIN_ID, name: 'Hyperliquid', morphoSlug: 'hyperevm' },
] as const;

export const SIDEBAR_NETWORKS = [
  { chainId: ETHEREUM_CHAIN_ID, name: 'Ethereum' },
  { chainId: BASE_CHAIN_ID, name: 'Base' },
] as const;

const ETHEREUM_SCAN_URL = 'https://etherscan.io';
const BASE_SCAN_URL = 'https://basescan.org';

const CHAIN_SCAN_URLS: Record<number, string> = {
  [ETHEREUM_CHAIN_ID]: ETHEREUM_SCAN_URL,
  [BASE_CHAIN_ID]: BASE_SCAN_URL,
};

export function getScanUrlForChain(chainId: number): string {
  return CHAIN_SCAN_URLS[chainId] ?? BASE_SCAN_URL;
}

export function getScanNameForChain(chainId: number): string {
  return chainId === ETHEREUM_CHAIN_ID ? 'Etherscan' : 'Basescan';
}

export const BPS_PER_ONE = 10000;

export const GRAPHQL_FIRST_LIMIT = 1000;
export const GRAPHQL_TRANSACTIONS_LIMIT = 10;

const MILLISECONDS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;

export const MINUTE_MS = MILLISECONDS_PER_SECOND * SECONDS_PER_MINUTE;
const HOUR_MS = MINUTE_MS * MINUTES_PER_HOUR;
const DAY_MS = HOUR_MS * HOURS_PER_DAY;

export const DAYS_30_MS = 30 * DAY_MS;

/** WAD max-rate annualization (per-second rate × year). */
export const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;

export const MORPHO_GRAPHQL_ENDPOINT = 'https://api.morpho.org/graphql';
export const MORPHO_APP_ORIGIN = 'https://app.morpho.org';

export const EXTERNAL_API_TIMEOUT_MS = 60000;
export const RATE_LIMIT_REQUESTS_PER_MINUTE = 60;

export const getDaysAgoTimestamp = (days: number): number => {
  return Math.floor((Date.now() - days * DAY_MS) / MILLISECONDS_PER_SECOND);
};
