'use client';

import type { ReactNode } from 'react';
import { formatFullUSD } from '@/lib/format/number';
import {
  formatAllocationTableAmount,
  resolveLiquidityAssetsRaw,
  type LiquidityDisplayUnit,
  type LiquidityRowLike,
} from '@/lib/format/allocation-display';

export function formatLiquidityCell(
  row: LiquidityRowLike,
  symbol: string,
  apiDecimals: number,
  vaultTotalUsd: number,
  vaultTotalRaw: bigint,
  unit: LiquidityDisplayUnit = 'both'
): ReactNode {
  const usd =
    row.liquidity != null && Number.isFinite(row.liquidity)
      ? formatFullUSD(row.liquidity, 2)
      : null;

  let token: string | null = null;
  const raw = resolveLiquidityAssetsRaw(row, vaultTotalUsd, vaultTotalRaw);
  if (raw != null) {
    token = formatAllocationTableAmount(raw, symbol, apiDecimals);
  }

  if (unit === 'usd') return usd ?? '—';
  if (unit === 'token') return token ?? '—';

  if (!usd && !token) return '—';
  if (usd && token) {
    return (
      <div className="flex flex-col items-end gap-0.5 leading-tight">
        <span>{usd}</span>
        <span className="text-xs font-medium text-foreground/80">{token}</span>
      </div>
    );
  }
  return usd ?? token ?? '—';
}
