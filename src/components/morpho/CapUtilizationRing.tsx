'use client';

import { cn } from '@/lib/utils';

/** Compact circular utilization meter next to Morpho-style cap values. */
export function CapUtilizationRing({
  percent,
  className,
}: {
  percent: number | null;
  className?: string;
}) {
  if (percent == null || !Number.isFinite(percent)) return null;
  const p = Math.max(0, Math.min(100, percent));
  const r = 6;
  const c = 2 * Math.PI * r;
  const dash = (p / 100) * c;
  return (
    <svg
      viewBox="0 0 16 16"
      className={cn('h-3.5 w-3.5 shrink-0 text-blue-500', className)}
      aria-hidden
    >
      <circle
        cx="8"
        cy="8"
        r={r}
        fill="none"
        className="text-muted-foreground/25"
        stroke="currentColor"
        strokeWidth="2.5"
      />
      <circle
        cx="8"
        cy="8"
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeDasharray={`${dash} ${c - dash}`}
        strokeLinecap="round"
        transform="rotate(-90 8 8)"
      />
    </svg>
  );
}
