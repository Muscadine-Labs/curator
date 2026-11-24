'use client';

import {
  formatCompactUSD,
  formatFullUSD,
  formatRawTokenAmount,
} from '@/lib/format/number';
import { resolveTokenDisplayProps } from '@/lib/format/asset-decimals';

export function formatMarketTokenAmount(
  raw: string | null | undefined,
  symbol: string,
  decimals: number | null | undefined,
): string | null {
  if (raw == null || raw === '') return null;
  const { chainDecimals, displayDecimals } = resolveTokenDisplayProps(symbol, decimals);
  try {
    return `${formatRawTokenAmount(BigInt(raw), chainDecimals, displayDecimals)} ${symbol}`;
  } catch {
    return null;
  }
}

/** Token amount primary; USD secondary when available. */
export function TokenUsdValue({
  underlying,
  usd,
  assetSymbol,
  chainDecimals,
  displayDecimals,
  compactUsd = false,
  align = 'right',
}: {
  underlying: string | null | undefined;
  usd: number | null | undefined;
  assetSymbol: string;
  chainDecimals: number;
  displayDecimals: number;
  compactUsd?: boolean;
  align?: 'left' | 'right';
}) {
  let tokenLine: string | null = null;
  if (underlying != null && underlying !== '') {
    try {
      tokenLine = `${formatRawTokenAmount(BigInt(underlying), chainDecimals, displayDecimals)} ${assetSymbol}`;
    } catch {
      tokenLine = null;
    }
  }

  if (tokenLine == null && usd == null) return '—';

  const usdLabel =
    usd != null
      ? compactUsd
        ? formatCompactUSD(usd)
        : formatFullUSD(usd, 2)
      : null;

  const alignClass = align === 'right' ? 'sm:text-right' : undefined;

  if (tokenLine != null) {
    return (
      <div className={alignClass}>
        <p className="font-medium tabular-nums">{tokenLine}</p>
        {usdLabel != null && (
          <p className="mt-0.5 text-xs font-normal tabular-nums text-muted-foreground">
            {usdLabel}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className={alignClass}>
      <p className="font-medium tabular-nums">{usdLabel ?? '—'}</p>
    </div>
  );
}
