'use client';

import type { DustRecipientChoice } from '@/lib/onchain/allocation-dust';

export interface DustRecipientOption {
  id: string;
  label: string;
}

interface DustRecipientSelectProps {
  value: DustRecipientChoice;
  onChange: (value: DustRecipientChoice) => void;
  options: ReadonlyArray<DustRecipientOption>;
  /** Label for the 'auto' option. V1 default: largest target. V2 passes 'Idle'. */
  autoLabel?: string;
}

/**
 * Pick which market / adapter row absorbs rounding dust before submit.
 */
export function DustRecipientSelect({
  value,
  onChange,
  options,
  autoLabel = 'Auto (largest target)',
}: DustRecipientSelectProps) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
      <label htmlFor="dust-recipient" className="text-xs text-muted-foreground whitespace-nowrap">
        Dust recipient
      </label>
      <select
        id="dust-recipient"
        value={value}
        onChange={(e) => onChange(e.target.value as DustRecipientChoice)}
        className="h-8 min-w-[10rem] max-w-full rounded-md border border-input bg-background px-2 text-xs"
      >
        <option value="auto">{autoLabel}</option>
        {options.map((opt) => (
          <option key={opt.id} value={opt.id}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
