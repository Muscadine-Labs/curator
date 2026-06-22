import { formatRawTokenAmount } from '@/lib/format/number';
import { formatRelativeCapWad } from '@/lib/morpho/vault-v2-api';
import {
  getTokenDisplayDecimals,
  resolveAssetDecimals,
} from '@/lib/format/asset-decimals';
import { isAdapterCap, isCollateralCap, isMarketCap } from '@/lib/morpho/cap-utils';
import type { CapInfo } from '@/app/api/vaults/v2/[id]/governance/route';
import type { V2VaultRiskResponse } from '@/app/api/vaults/v2/[id]/risk/route';
import { formatMarketPairLabel } from '@/components/morpho/AllocationListView';
import { marketKeyFromGraphQL } from '@/lib/morpho/morpho-app-links';

export function formatCapTokenAmount(
  value: string,
  symbol: string | null | undefined,
  apiDecimals: number | null | undefined
): string {
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
    const sym = resolveCollateralSymbol(cap.collateralAddress, risk);
    return sym ?? truncateHex(cap.collateralAddress);
  }

  if (isMarketCap(cap) && cap.marketKey) {
    const pair = resolveMarketPair(cap.marketKey, risk);
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
  risk: V2VaultRiskResponse | null | undefined
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
  adapters: { address: string; type: string; metaMorpho?: { name?: string | null; symbol?: string | null } | null }[]
): Map<string, string> {
  const map = new Map<string, string>();
  for (const a of adapters) {
    const label =
      a.metaMorpho?.name ??
      a.metaMorpho?.symbol ??
      (a.type === 'MetaMorpho' || a.type === 'MetaMorphoAdapter'
        ? 'MetaMorpho Adapter'
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
