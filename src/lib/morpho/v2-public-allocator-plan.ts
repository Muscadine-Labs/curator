import { getAddress, type Address } from 'viem';
import { resolveMarketParamsTuple, type MarketParamsInput } from '@/lib/morpho/v2-id-data';

export type PublicAllocatorMarketEdit = {
  label: string;
  adapterAddress: string;
  market: MarketParamsInput;
  currentAbsoluteCap: bigint | null;
  nextAbsoluteCap: bigint;
  currentCanPull: boolean | null;
  nextCanPull: boolean;
};

export type PublicAllocatorChange =
  | { kind: 'idle'; next: boolean }
  | {
      kind: 'absoluteCap';
      label: string;
      adapter: Address;
      market: ReturnType<typeof resolveMarketParamsTuple>;
      before: bigint;
      next: bigint;
    }
  | {
      kind: 'pull';
      label: string;
      adapter: Address;
      market: ReturnType<typeof resolveMarketParamsTuple>;
      before: boolean;
      next: boolean;
    };

/**
 * Allocator edits that differ from the last read. A failed read (`null`) is
 * left untouched so a blank cell is not written as zero or "not allowed".
 */
export function diffPublicAllocatorEdits(input: {
  currentIdle: boolean | null;
  nextIdle: boolean;
  markets: PublicAllocatorMarketEdit[];
}): PublicAllocatorChange[] {
  const changes: PublicAllocatorChange[] = [];

  if (input.currentIdle != null && input.nextIdle !== input.currentIdle) {
    changes.push({ kind: 'idle', next: input.nextIdle });
  }

  for (const row of input.markets) {
    const adapter = getAddress(row.adapterAddress);
    const market = resolveMarketParamsTuple(row.market);
    if (row.currentAbsoluteCap != null && row.nextAbsoluteCap !== row.currentAbsoluteCap) {
      changes.push({
        kind: 'absoluteCap',
        label: row.label,
        adapter,
        market,
        before: row.currentAbsoluteCap,
        next: row.nextAbsoluteCap,
      });
    }
    if (row.currentCanPull != null && row.nextCanPull !== row.currentCanPull) {
      changes.push({
        kind: 'pull',
        label: row.label,
        adapter,
        market,
        before: row.currentCanPull,
        next: row.nextCanPull,
      });
    }
  }

  return changes;
}
