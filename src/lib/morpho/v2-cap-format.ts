import { formatRawTokenAmount } from '@/lib/format/number';
import { formatRelativeCapWad } from '@/lib/morpho/vault-v2-api';
import {
  getTokenDisplayDecimals,
  resolveAssetDecimals,
} from '@/lib/format/asset-decimals';
import { isAdapterCap, isCollateralCap, isMarketCap } from '@/lib/morpho/cap-utils';
import {
  isMorphoVaultV2Adapter,
  underlyingVaultLabel,
  UNDERLYING_VAULT_FALLBACK,
} from '@/lib/morpho/vault-v2-adapter';
import type { CapInfo } from '@/app/api/vaults/[id]/governance/route';
import type { V2VaultRiskResponse } from '@/app/api/vaults/[id]/risk/route';
import { formatLltvPill, formatMarketPairLabel } from '@/components/morpho/AllocationListView';
import { marketKeyFromGraphQL } from '@/lib/morpho/morpho-app-links';

const UINT128_MAX = (1n << 128n) - 1n;
const UINT256_MAX = (1n << 256n) - 1n;

/** Morpho Vault V2 treats uint128 max (and similarly huge values) as uncapped. */
function isInfiniteCapValue(value: string | bigint): boolean {
  try {
    const raw = typeof value === 'bigint' ? value : BigInt(value);
    return raw === UINT128_MAX || raw === UINT256_MAX || raw >= 10n ** 30n;
  } catch {
    return false;
  }
}

export function formatCapTokenAmount(
  value: string,
  symbol: string | null | undefined,
  apiDecimals: number | null | undefined
): string {
  if (isInfiniteCapValue(value)) return 'Infinite';
  try {
    const raw = BigInt(value);
    const chainDecimals = resolveAssetDecimals(symbol ?? undefined, apiDecimals ?? undefined);
    const displayDecimals = getTokenDisplayDecimals(symbol ?? undefined, chainDecimals);
    const formatted = formatRawTokenAmount(raw, chainDecimals, displayDecimals);
    return symbol ? `${formatted} ${symbol}` : formatted;
  } catch {
    return value;
  }
}

function formatCompactHuman(n: number): string {
  if (n === 0) return '0';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const withSuffix = (x: number, suffix: string) => {
    const s = x.toFixed(2).replace(/\.?0+$/, '');
    return `${sign}${s}${suffix}`;
  };
  if (abs >= 1_000_000) return withSuffix(abs / 1_000_000, 'M');
  if (abs >= 1_000) return withSuffix(abs / 1_000, 'k');
  return `${sign}${abs.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

/** Morpho Curator-style compact amounts (`83.36k USDC`, `1M USDC`). */
export function formatCapCompactAmount(
  value: string | null | undefined,
  symbol: string | null | undefined,
  apiDecimals: number | null | undefined
): string {
  if (value == null || value === '') return '—';
  if (isInfiniteCapValue(value)) return 'Infinite';
  try {
    const raw = BigInt(value);
    const chainDecimals = resolveAssetDecimals(symbol ?? undefined, apiDecimals ?? undefined);
    const human = Number(raw) / 10 ** chainDecimals;
    if (!Number.isFinite(human)) {
      return formatCapTokenAmount(value, symbol, apiDecimals);
    }
    const compact = formatCompactHuman(human);
    return symbol ? `${compact} ${symbol}` : compact;
  } catch {
    return '—';
  }
}

export function sortCapsByAllocationDesc(caps: CapInfo[]): CapInfo[] {
  return [...caps].sort((a, b) => {
    try {
      const diff = BigInt(b.allocation ?? '0') - BigInt(a.allocation ?? '0');
      if (diff > 0n) return 1;
      if (diff < 0n) return -1;
      return 0;
    } catch {
      return 0;
    }
  });
}

export function absoluteCapUtilizationPercent(
  allocation: string,
  absoluteCap: string
): number | null {
  try {
    const alloc = BigInt(allocation);
    const cap = BigInt(absoluteCap);
    if (isInfiniteCapValue(cap) || cap === 0n) return null;
    return Number((alloc * 10_000n) / cap) / 100;
  } catch {
    return null;
  }
}

export function relativeCapUtilizationPercent(
  allocation: string,
  relativeCapWad: string,
  totalAssets: string | null | undefined
): number | null {
  if (totalAssets == null || totalAssets === '') return null;
  try {
    const alloc = BigInt(allocation);
    const relative = BigInt(relativeCapWad);
    const total = BigInt(totalAssets);
    if (relative === 0n || total === 0n) return null;
    const capAssets = (total * relative) / 10n ** 18n;
    if (capAssets === 0n) return null;
    return Number((alloc * 10_000n) / capAssets) / 100;
  } catch {
    return null;
  }
}

export function formatCapRelative(relativeCap: string): string {
  return formatRelativeCapWad(relativeCap);
}

export function capSectionLabel(cap: CapInfo): 'adapter' | 'collateral' | 'market' {
  if (isAdapterCap(cap)) return 'adapter';
  if (isCollateralCap(cap)) return 'collateral';
  if (isMarketCap(cap)) return 'market';
  return 'adapter';
}

export function capDisplayLabel(
  cap: CapInfo,
  risk: V2VaultRiskResponse | null | undefined,
  adapterLabels: Map<string, string>
): string {
  if (isAdapterCap(cap) && cap.adapterAddress) {
    return adapterLabels.get(cap.adapterAddress.toLowerCase()) ?? 'Adapter';
  }

  if (isCollateralCap(cap) && cap.collateralAddress) {
    if (cap.collateralSymbol) return cap.collateralSymbol;
    const sym = resolveCollateralSymbol(cap.collateralAddress, risk);
    return sym ?? truncateHex(cap.collateralAddress);
  }

  if (isMarketCap(cap) && cap.marketKey) {
    const pair = resolveMarketPair(cap.marketKey, risk, cap.marketParams);
    if (pair) return pair;
    return truncateHex(cap.marketKey);
  }

  return 'Cap';
}

function truncateHex(value: string): string {
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function resolveCollateralSymbol(
  collateralAddress: string,
  risk: V2VaultRiskResponse | null | undefined
): string | null {
  const needle = collateralAddress.toLowerCase();
  for (const adapter of risk?.adapters ?? []) {
    for (const m of adapter.markets ?? []) {
      const addr = m.market?.collateralAsset?.address?.toLowerCase();
      if (addr === needle) return m.market?.collateralAsset?.symbol ?? null;
    }
  }
  return null;
}

function resolveMarketPair(
  marketKey: string,
  risk: V2VaultRiskResponse | null | undefined,
  marketParams?: CapInfo['marketParams']
): string | null {
  const needle = marketKey.toLowerCase();
  for (const adapter of risk?.adapters ?? []) {
    for (const m of adapter.markets ?? []) {
      const key = marketKeyFromGraphQL(m.market);
      if (key?.toLowerCase() === needle) {
        return formatMarketPairLabel(
          m.market?.collateralAsset?.symbol,
          m.market?.loanAsset?.symbol
        );
      }
    }
  }
  if (marketParams?.loanAsset?.address && marketParams?.collateralAsset?.address) {
    return formatMarketPairLabel(
      marketParams.collateralAsset.symbol,
      marketParams.loanAsset.symbol
    );
  }
  return null;
}

export function capLltvPill(
  cap: CapInfo,
  risk: V2VaultRiskResponse | null | undefined
): string | null {
  if (!isMarketCap(cap) || !cap.marketKey) return null;
  if (cap.marketParams?.lltv) return formatLltvPill(cap.marketParams.lltv);
  const needle = cap.marketKey.toLowerCase();
  for (const adapter of risk?.adapters ?? []) {
    for (const m of adapter.markets ?? []) {
      const key = marketKeyFromGraphQL(m.market);
      if (key?.toLowerCase() === needle) {
        return formatLltvPill(m.market?.lltv ?? null);
      }
    }
  }
  return null;
}

export function groupCaps(caps: CapInfo[]): {
  adapter: CapInfo[];
  collateral: CapInfo[];
  market: CapInfo[];
} {
  const adapter: CapInfo[] = [];
  const collateral: CapInfo[] = [];
  const market: CapInfo[] = [];

  for (const cap of caps) {
    const section = capSectionLabel(cap);
    if (section === 'adapter') adapter.push(cap);
    else if (section === 'collateral') collateral.push(cap);
    else market.push(cap);
  }

  return { adapter, collateral, market };
}

export function buildAdapterLabelMap(
  adapters: {
    address: string;
    type: string;
    metaMorpho?: { name?: string | null; symbol?: string | null } | null;
    underlying?: { name?: string | null; symbol?: string | null } | null;
  }[]
): Map<string, string> {
  const map = new Map<string, string>();
  for (const a of adapters) {
    const label =
      underlyingVaultLabel(a.underlying, '') ||
      a.metaMorpho?.name ||
      a.metaMorpho?.symbol ||
      (a.type === 'MetaMorpho' || a.type === 'MetaMorphoAdapter'
        ? 'MetaMorpho Adapter'
        : isMorphoVaultV2Adapter(a)
          ? UNDERLYING_VAULT_FALLBACK
          : 'Variable Rate Market Adapter');
    map.set(a.address.toLowerCase(), label);
  }
  return map;
}

/** Stable React list key — market caps share an adapter address across rows. */
export function capRowKey(cap: CapInfo, index: number): string {
  return [
    cap.type,
    cap.adapterAddress ?? '',
    cap.marketKey ?? '',
    cap.collateralAddress ?? '',
    cap.absoluteCap,
    cap.relativeCap,
    String(index),
  ].join('|');
}
