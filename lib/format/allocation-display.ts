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
  const display = getTokenDisplayDecimals(symbol, chain);
  return formatRawTokenAmount(capRaw, chain, display);
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
