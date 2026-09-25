import { parseUnits } from 'viem';
import { parseHumanTokenInput } from '@/lib/format/allocation-display';

export type CapDecreaseMode = 'absolute' | 'relative';

export type ParsedCapDecrease =
  | { ok: true; mode: 'absolute'; value: bigint }
  | { ok: true; mode: 'relative'; value: bigint }
  | { ok: false; error: string };

export function parseCapDecreaseInput(input: {
  mode: CapDecreaseMode;
  valueStr: string;
  currentAbsoluteRaw: string;
  currentRelativeRaw: string;
  assetSymbol: string | null | undefined;
  chainDecimals: number;
}): ParsedCapDecrease {
  const trimmed = input.valueStr.trim();
  if (!trimmed) {
    return { ok: false, error: 'Enter a new cap value.' };
  }

  if (input.mode === 'absolute') {
    let parsed: bigint;
    try {
      parsed = parseHumanTokenInput(trimmed, input.assetSymbol, input.chainDecimals);
    } catch {
      return { ok: false, error: 'Invalid token amount.' };
    }

    if (parsed < 0n) {
      return { ok: false, error: 'Cap cannot be negative.' };
    }

    let current: bigint;
    try {
      current = BigInt(input.currentAbsoluteRaw);
    } catch {
      return { ok: false, error: 'Current absolute cap is unavailable.' };
    }

    if (parsed > current) {
      return {
        ok: false,
        error: 'New absolute cap must be less than or equal to the current cap.',
      };
    }

    return { ok: true, mode: 'absolute', value: parsed };
  }

  // Plain decimal only: Number() would also accept '1e1' or '0x10'.
  const pct = /^\d+(\.\d+)?$|^\.\d+$/.test(trimmed) ? Number(trimmed) : NaN;
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
    return { ok: false, error: 'Relative cap must be a percentage between 0 and 100.' };
  }

  // Exact decimal → WAD. `Math.round(pct * 1e16)` is off by a few wei for ~7%
  // of 2-dp inputs (0.28 → 2800000000000001), which rejects re-entering the
  // current cap and writes a dirty WAD on-chain.
  const wad = parseUnits(trimmed, 16);
  let current: bigint;
  try {
    current = BigInt(input.currentRelativeRaw);
  } catch {
    return { ok: false, error: 'Current relative cap is unavailable.' };
  }

  if (wad > current) {
    return {
      ok: false,
      error: 'New relative cap must be less than or equal to the current cap.',
    };
  }

  return { ok: true, mode: 'relative', value: wad };
}
