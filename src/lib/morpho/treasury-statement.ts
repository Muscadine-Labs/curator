import {
  getVaultAddressesForBusinessViews,
  getVaultByAddress,
} from '@/lib/config/vaults';
import { utcCalendarYear } from '@/lib/utils/utc-calendar';

/** Safe that receives vault performance fees and holds vault share positions. */
export const TREASURY_ADDRESS = '0x057fd8B961Eb664baA647a5C7A6e9728fabA266A';

/** Monthly statements begin November 2025. */
export const STATEMENT_START_DATE = new Date('2025-11-01T00:00:00Z');

export type TreasuryAssetKey = 'USDC' | 'cbBTC' | 'WETH';

export type TreasuryAssetBreakdown = Record<
  TreasuryAssetKey,
  { tokens: number; usd: number }
>;

export function emptyTreasuryAssetBreakdown(): TreasuryAssetBreakdown {
  return {
    USDC: { tokens: 0, usd: 0 },
    cbBTC: { tokens: 0, usd: 0 },
    WETH: { tokens: 0, usd: 0 },
  };
}

export function sumTreasuryBreakdownUsd(assets: TreasuryAssetBreakdown): number {
  return assets.USDC.usd + assets.cbBTC.usd + assets.WETH.usd;
}

/** Sum treasury net revenue for calendar year-to-date from monthly statement rows. */
export function sumTreasuryRevenueYtd(
  statements: ReadonlyArray<{ month: string; total: { usd: number } }>,
  year: number = utcCalendarYear()
): number {
  const prefix = `${year}-`;
  return statements
    .filter((s) => s.month.startsWith(prefix))
    .reduce((sum, s) => sum + (s.total?.usd ?? 0), 0);
}

/** YTD treasury revenue from daily net-change series (includes partial current month). */
export function sumTreasuryRevenueYtdFromDaily(
  daily: ReadonlyArray<{ date: string; value: number }>,
  year: number = utcCalendarYear()
): number {
  const prefix = `${year}-`;
  return daily.filter((d) => d.date.startsWith(prefix)).reduce((sum, d) => sum + d.value, 0);
}

/** V1 MetaMorpho — treasury fee accounting only; not in lib/config/vaults.ts */
const V1_TREASURY_VAULT_ASSETS: Record<string, TreasuryAssetKey> = {
  '0xf7e26fa48a568b8b0038e104dfd8abdf0f99074f': 'USDC',
  '0x21e0d366272798da3a977feba699fcb91959d120': 'WETH',
  '0xaecc8113a7bd0cfaf7000ea7a31affd4691ff3e9': 'cbBTC',
};

function buildVaultAssetMap(): Record<string, TreasuryAssetKey> {
  const map: Record<string, TreasuryAssetKey> = { ...V1_TREASURY_VAULT_ASSETS };
  for (const vault of getVaultAddressesForBusinessViews()) {
    map[vault.address.toLowerCase()] = vault.assetSymbol;
  }
  return map;
}

/** Vault share tokens → treasury asset bucket (configured V2 vaults + V1 MetaMorpho). */
export const VAULT_ASSET_MAP: Record<string, TreasuryAssetKey> = buildVaultAssetMap();

/** Map a Morpho vault position to USDC / WETH / cbBTC. Unknown tokens are skipped (no spam ERC-20s). */
export function treasuryAssetKeyForVault(
  vaultAddress: string,
  assetSymbol?: string | null
): TreasuryAssetKey | null {
  const cfg = getVaultByAddress(vaultAddress);
  if (cfg && !cfg.excludeFromBusinessViews) return cfg.assetSymbol;
  const mapped = VAULT_ASSET_MAP[vaultAddress.toLowerCase()];
  if (mapped) return mapped;
  const symbol = (assetSymbol ?? '').trim().toUpperCase();
  if (symbol === 'USDC' || symbol === 'USDBC') return 'USDC';
  if (symbol === 'WETH' || symbol === 'ETH') return 'WETH';
  if (symbol === 'CBBTC') return 'cbBTC';
  return null;
}

export type TreasuryVaultMonthlyRow = {
  vaultAddress: string;
  month: string;
  usd: number;
};

/** Sum net treasury performance fees by vault address (lowercase keys). */
export function aggregateTreasuryRevenueByVault(
  rows: ReadonlyArray<TreasuryVaultMonthlyRow>
): Record<string, number> {
  const map: Record<string, number> = {};
  for (const row of rows) {
    const addr = row.vaultAddress.toLowerCase();
    map[addr] = (map[addr] ?? 0) + (row.usd ?? 0);
  }
  return map;
}

/** All-time treasury revenue for a vault overview card. */
export function treasuryRevenueAllTimeForVault(
  revenueByVault: Record<string, number>,
  vaultAddress: string
): number | null {
  const addr = vaultAddress.toLowerCase();
  if (revenueByVault[addr] == null) return null;
  return revenueByVault[addr] ?? 0;
}

/** YTD treasury revenue for a vault from per-vault monthly rows. */
export function treasuryRevenueYtdForVault(
  rows: ReadonlyArray<TreasuryVaultMonthlyRow>,
  vaultAddress: string,
  year = utcCalendarYear()
): number | null {
  const addr = vaultAddress.toLowerCase();
  const yearPrefix = `${year}-`;

  let total = 0;
  let found = false;
  for (const row of rows) {
    if (!row.month.startsWith(yearPrefix)) continue;
    if (row.vaultAddress.toLowerCase() !== addr) continue;
    total += row.usd ?? 0;
    found = true;
  }
  return found ? total : null;
}
