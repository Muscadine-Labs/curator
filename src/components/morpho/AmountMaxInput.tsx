'use client';

import { formatUnits, parseUnits } from 'viem';
import { Input } from '@/components/ui/input';
import { formatAllocationEditInputExact } from '@/lib/format/allocation-display';
import { cn } from '@/lib/utils';

export function sanitizeAmountInput(value: string, decimals: number): string | null {
  const cleaned = value.replace(/,/g, '');
  if (cleaned === '') return '';
  if (!/^\d*\.?\d*$/.test(cleaned)) return null;
  const dot = cleaned.indexOf('.');
  if (dot >= 0 && cleaned.length - dot - 1 > decimals) {
    return cleaned.slice(0, dot + 1 + decimals);
  }
  return cleaned;
}

export function formatMaxInputAmount(raw: bigint, decimals: number): string {
  if (raw <= 0n) return '0';
  return formatUnits(raw, decimals);
}

/** Parse a MAX-filled or typed amount with the same decimals as formatUnits. */
export function parseExactAmount(value: string, decimals: number): bigint {
  const cleaned = value.trim().replace(/,/g, '');
  if (!cleaned || cleaned === '.' || cleaned === '-') return 0n;
  return parseUnits(cleaned, decimals);
}

/** True when `entered` is max, or within 0.01% / 1 wei — use for full-exit by shares. */
export function isNearFullAmount(entered: bigint, max: bigint): boolean {
  if (max <= 0n) return entered <= 0n;
  if (entered >= max) return true;
  const slack = max / 10_000n > 0n ? max / 10_000n : 1n;
  return max - entered <= slack;
}

export function evaluateAmountInput(
  value: string,
  decimals: number,
  maxRaw: bigint | null
): { raw: bigint; positive: boolean; exceeds: boolean } {
  if (!value.trim()) {
    return { raw: 0n, positive: false, exceeds: false };
  }
  try {
    const raw = parseExactAmount(value, decimals);
    return {
      raw,
      positive: raw > 0n,
      exceeds: maxRaw != null && raw > maxRaw,
    };
  } catch {
    return { raw: 0n, positive: false, exceeds: false };
  }
}

export function amountExceedsMax(
  value: string,
  maxRaw: bigint | null,
  decimals: number
): boolean {
  return evaluateAmountInput(value, decimals, maxRaw).exceeds;
}

export function hasPositiveAmount(value: string, decimals: number): boolean {
  return evaluateAmountInput(value, decimals, null).positive;
}

type AmountMaxInputProps = {
  id: string;
  label: string;
  hint?: string;
  symbol: string;
  decimals: number;
  value: string;
  onChange: (next: string) => void;
  maxRaw: bigint | null;
  maxLoading?: boolean;
  disabled?: boolean;
  placeholder?: string;
  availableCaption?: string;
  className?: string;
};

export function AmountMaxInput({
  id,
  label,
  hint,
  symbol,
  decimals,
  value,
  onChange,
  maxRaw,
  maxLoading = false,
  disabled = false,
  placeholder = '0',
  availableCaption = 'Available',
  className,
}: AmountMaxInputProps) {
  const maxDisabled = disabled || maxLoading || maxRaw == null || maxRaw <= 0n;
  const availableDisplay =
    maxRaw == null
      ? '—'
      : formatAllocationEditInputExact(maxRaw, symbol, decimals, true);
  const exceeds = evaluateAmountInput(value, decimals, maxRaw).exceeds;

  const fillMax = () => {
    if (maxRaw == null || maxRaw <= 0n) return;
    onChange(formatMaxInputAmount(maxRaw, decimals));
  };

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-start justify-between gap-2">
        <label htmlFor={id} className="text-xs font-medium text-foreground">
          {label}
        </label>
        {hint ? (
          <p className="max-w-[70%] text-right text-[11px] leading-snug text-muted-foreground">
            {hint}
          </p>
        ) : null}
      </div>
      <Input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => {
          const next = sanitizeAmountInput(e.target.value, decimals);
          if (next != null) onChange(next);
        }}
        className="h-11 w-full font-mono text-base tabular-nums"
      />
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-[11px] text-muted-foreground">
          {availableCaption}
        </p>
        <div className="flex min-w-0 items-center gap-2">
          <p className="truncate text-xs tabular-nums text-muted-foreground">
            {maxLoading ? '…' : `${availableDisplay} ${symbol}`}
          </p>
          <button
            type="button"
            onClick={fillMax}
            disabled={maxDisabled}
            aria-label={`Max ${symbol}`}
            className="shrink-0 text-xs font-semibold tracking-wide text-foreground hover:text-foreground/80 disabled:cursor-not-allowed disabled:text-muted-foreground"
          >
            MAX
          </button>
        </div>
      </div>
      {exceeds ? (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          Amount exceeds available.
        </p>
      ) : null}
    </div>
  );
}
