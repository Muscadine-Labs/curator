import { formatFullUSD, formatRawTokenAmount } from '@/lib/format/number';
import {
  getTokenDisplayDecimals,
  resolveAssetDecimals,
} from '@/lib/format/asset-decimals';

export type AllocationAmountUnit = 'usd' | 'token';

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
