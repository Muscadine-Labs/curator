/** Safe that receives vault performance fees and holds vault share positions. */
export const TREASURY_ADDRESS = '0x057fd8B961Eb664baA647a5C7A6e9728fabA266A';

/**
 * V1 vaults replaced by V2 successors — V1 performance fees roll up to the V2
 * vault on overview revenue (treasury migrated positions, fees still count).
 */
export const V1_TO_V2_REVENUE_SUCCESSOR: Record<string, string> = {
  '0xf7e26fa48a568b8b0038e104dfd8abdf0f99074f': '0x89712980cb434ef5ae4ab29349419eb976b0b496',
  '0xaecc8113a7bd0cfaf7000ea7a31affd4691ff3e9': '0x99dcd0d75822ba398f13b2a8852b07c7e137ec70',
  '0x21e0d366272798da3a977feba699fcb91959d120': '0xd6dcad2f7da91fbb27bda471540d9770c97a5a43',
};

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
  year: number = new Date().getFullYear()
): number {
  const prefix = `${year}-`;
  return statements
    .filter((s) => s.month.startsWith(prefix))
    .reduce((sum, s) => sum + (s.total?.usd ?? 0), 0);
}

/** YTD treasury revenue from daily net-change series (includes partial current month). */
export function sumTreasuryRevenueYtdFromDaily(
  daily: ReadonlyArray<{ date: string; value: number }>,
  year: number = new Date().getFullYear()
): number {
  const prefix = `${year}-`;
  return daily.filter((d) => d.date.startsWith(prefix)).reduce((sum, d) => sum + d.value, 0);
}

export const VAULT_ASSET_MAP: Record<string, TreasuryAssetKey> = {
  '0xf7e26fa48a568b8b0038e104dfd8abdf0f99074f': 'USDC',
  '0x89712980cb434ef5ae4ab29349419eb976b0b496': 'USDC',
  '0x314fd07319ef645ba7d548915ccd91f4788a1839': 'USDC',
  '0xaecc8113a7bd0cfaf7000ea7a31affd4691ff3e9': 'cbBTC',
  '0x99dcd0d75822ba398f13b2a8852b07c7e137ec70': 'cbBTC',
  '0x21e0d366272798da3a977feba699fcb91959d120': 'WETH',
  '0xd6dcad2f7da91fbb27bda471540d9770c97a5a43': 'WETH',
};

export const VAULT_VERSION_MAP: Record<string, 'v1' | 'v2'> = {
  '0xf7e26fa48a568b8b0038e104dfd8abdf0f99074f': 'v1',
  '0x89712980cb434ef5ae4ab29349419eb976b0b496': 'v2',
  '0x314fd07319ef645ba7d548915ccd91f4788a1839': 'v2',
  '0xaecc8113a7bd0cfaf7000ea7a31affd4691ff3e9': 'v1',
  '0x99dcd0d75822ba398f13b2a8852b07c7e137ec70': 'v2',
  '0x21e0d366272798da3a977feba699fcb91959d120': 'v1',
  '0xd6dcad2f7da91fbb27bda471540d9770c97a5a43': 'v2',
};

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

/**
 * All-time treasury revenue for a vault overview card.
 * V2 successors include fees accrued while treasury held the matching V1 vault.
 */
export function treasuryRevenueAllTimeForVault(
  revenueByVault: Record<string, number>,
  vaultAddress: string
): number | null {
  const addr = vaultAddress.toLowerCase();
  let total = revenueByVault[addr] ?? 0;
  let found = revenueByVault[addr] != null;

  for (const [v1Addr, v2Addr] of Object.entries(V1_TO_V2_REVENUE_SUCCESSOR)) {
    if (v2Addr === addr && revenueByVault[v1Addr] != null) {
      total += revenueByVault[v1Addr] ?? 0;
      found = true;
    }
  }

  return found ? total : null;
}

/** YTD treasury revenue for a vault (includes rolled-up V1 predecessor fees). */
export function treasuryRevenueYtdForVault(
  rows: ReadonlyArray<TreasuryVaultMonthlyRow>,
  vaultAddress: string,
  year = new Date().getFullYear()
): number | null {
  const addr = vaultAddress.toLowerCase();
  const yearPrefix = `${year}-`;
  const v1Addrs = Object.entries(V1_TO_V2_REVENUE_SUCCESSOR)
    .filter(([, v2]) => v2 === addr)
    .map(([v1]) => v1);
  const matchAddrs = new Set([addr, ...v1Addrs]);

  let total = 0;
  let found = false;
  for (const row of rows) {
    if (!row.month.startsWith(yearPrefix)) continue;
    if (!matchAddrs.has(row.vaultAddress.toLowerCase())) continue;
    total += row.usd ?? 0;
    found = true;
  }
  return found ? total : null;
}
