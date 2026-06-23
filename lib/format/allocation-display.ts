import { parseUnits } from 'viem';
import { formatFullUSD, formatRawTokenAmount } from '@/lib/format/number';
import {
  getTokenDisplayDecimals,
  resolveAssetDecimals,
} from '@/lib/format/asset-decimals';

export type AllocationAmountUnit = 'usd' | 'token';

export function stripGroupingSeparators(value: string): string {
  return value.trim().replace(/,/g, '');
}

/** Parse a human-typed token amount (commas allowed). Returns 0n for empty/zero. */
export function parseHumanTokenInput(
  value: string,
  symbol: string | null | undefined,
  apiDecimals: number
): bigint {
  const cleaned = stripGroupingSeparators(value);
  if (!cleaned || cleaned === '.' || cleaned === '-') return 0n;
  const chain = resolveAssetDecimals(symbol, apiDecimals);
  return parseUnits(cleaned, chain);
}

/** Plain decimal string for rebalance inputs — no commas, bigint-safe. */
export function formatAllocationEditInput(
  raw: bigint,
  symbol: string | null | undefined,
  apiDecimals: number
): string {
  return formatAllocationEditInputExact(raw, symbol, apiDecimals, false);
}

/** Full chain-decimal string for Max / exact on-chain amounts (no display trimming). */
export function formatAllocationEditInputExact(
  raw: bigint,
  symbol: string | null | undefined,
  apiDecimals: number,
  trimTrailingZeros = true
): string {
  const chain = resolveAssetDecimals(symbol, apiDecimals);
  if (raw === 0n) return '0';

  const negative = raw < 0n;
  if (negative) raw = -raw;

  const base = 10n ** BigInt(chain);
  const whole = raw / base;
  const frac = raw % base;
  const fracPadded = frac.toString().padStart(chain, '0');

  let fracTrimmed = fracPadded;
  if (trimTrailingZeros) {
    const display = getTokenDisplayDecimals(symbol, chain);
    fracTrimmed =
      display < chain ? fracPadded.slice(0, display) : fracPadded;
    while (fracTrimmed.length > 1 && fracTrimmed.endsWith('0')) {
      fracTrimmed = fracTrimmed.slice(0, -1);
    }
  }

  const out =
    fracTrimmed.length > 0 ? `${whole.toString()}.${fracTrimmed}` : whole.toString();
  return negative ? `-${out}` : out;
}

/** Clamp a parsed deallocate amount to on-chain position size. */
export function clampDeallocateAmount(parsed: bigint, currentRaw: bigint): bigint {
  if (parsed <= 0n) return 0n;
  return parsed > currentRaw ? currentRaw : parsed;
}

/** Table display for allocation / liquidity cells. */
export function formatAllocationTableAmount(
  raw: bigint,
  symbol: string | null | undefined,
  apiDecimals: number
): string {
  const chain = resolveAssetDecimals(symbol, apiDecimals);
  const display = getTokenDisplayDecimals(symbol, chain);
  const amount = formatRawTokenAmount(raw, chain, display);
  return symbol ? `${amount} ${symbol}` : amount;
}

/** Desktop input width (ch) — USDC ~16, cbBTC ~18, WETH ~28. */
export function allocationInputWidthCh(
  symbol: string | null | undefined,
  apiDecimals: number
): number {
  const chain = resolveAssetDecimals(symbol, apiDecimals);
  const frac = getTokenDisplayDecimals(symbol, chain);
  return Math.max(16, 10 + frac);
}

export function formatAllocationAmount(
  unit: AllocationAmountUnit,
  usd: number,
  raw: bigint,
  symbol: string,
  apiDecimals: number
): string {
  if (unit === 'usd') return formatFullUSD(usd, 2);
  const chain = resolveAssetDecimals(symbol, apiDecimals);
  const display = getTokenDisplayDecimals(symbol, chain);
  return `${formatRawTokenAmount(raw, chain, display)} ${symbol}`.trim();
}

export function formatCapRawAmount(
  capRaw: bigint,
  symbol: string,
  apiDecimals: number
): string {
  const chain = resolveAssetDecimals(symbol, apiDecimals);
  return formatRawTokenAmount(capRaw, chain, 0);
}

export function formatCapDisplayAmount(
  capRaw: bigint | null | undefined,
  symbol: string | null | undefined,
  apiDecimals: number
): string {
  if (capRaw == null) return '—';
  const formatted = formatCapRawAmount(capRaw, symbol ?? '', apiDecimals);
  return symbol ? `${formatted} ${symbol}` : formatted;
}

export type LiquidityDisplayUnit = 'both' | 'usd' | 'token';

export type LiquidityRowLike = {
  liquidity: number | null;
  liquidityAssets: string | number | null | undefined;
  allocated: number;
  allocAssets: string | null;
};

export function estimateRawFromUsd(
  usd: number,
  referenceUsd: number,
  referenceRaw: bigint
): bigint | null {
  if (!Number.isFinite(usd) || usd <= 0 || !Number.isFinite(referenceUsd) || referenceUsd <= 0) {
    return null;
  }
  if (referenceRaw <= 0n) return null;
  const usdMicro = BigInt(Math.round(usd * 1_000_000));
  const refUsdMicro = BigInt(Math.round(referenceUsd * 1_000_000));
  if (refUsdMicro === 0n) return null;
  return (usdMicro * referenceRaw) / refUsdMicro;
}

export function resolveLiquidityAssetsRaw(
  row: LiquidityRowLike,
  vaultTotalUsd: number,
  vaultTotalRaw: bigint
): bigint | null {
  if (row.liquidityAssets != null && row.liquidityAssets !== '') {
    try {
      return BigInt(String(row.liquidityAssets).split('.')[0] ?? '');
    } catch {
      /* fall through */
    }
  }

  if (row.allocAssets && row.allocated > 0 && row.liquidity != null && row.liquidity > 0) {
    try {
      const allocRaw = BigInt(row.allocAssets);
      if (allocRaw > 0n) {
        return estimateRawFromUsd(row.liquidity, row.allocated, allocRaw);
      }
    } catch {
      /* fall through */
    }
  }

  if (row.liquidity != null && row.liquidity > 0) {
    return estimateRawFromUsd(row.liquidity, vaultTotalUsd, vaultTotalRaw);
  }

  return null;
}

export type MarketLiquidityState = {
  liquidityAssetsUsd?: number | null;
  liquidityAssets?: string | number | null;
};

export function readMarketLiquidity(
  state: MarketLiquidityState | null | undefined,
  vaultTotalUsd: number,
  vaultTotalRaw: bigint
): { usd: number | null; assets: string | null } {
  const usd = state?.liquidityAssetsUsd ?? null;
  let assets =
    state?.liquidityAssets != null && state.liquidityAssets !== ''
      ? String(state.liquidityAssets).split('.')[0] ?? null
      : null;

  if (!assets && usd != null && usd > 0) {
    const estimated = estimateRawFromUsd(usd, vaultTotalUsd, vaultTotalRaw);
    if (estimated != null) assets = estimated.toString();
  }

  return { usd, assets };
}
