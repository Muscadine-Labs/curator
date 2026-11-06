'use client';

import { cn } from '@/lib/utils';

interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
  /** Shown as the tooltip, e.g. why the switch is disabled. */
  title?: string;
  className?: string;
}

/** Small labelled on/off switch (`role="switch"`), sized for touch. */
export function Switch({ checked, onCheckedChange, label, disabled, title, className }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      title={title}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'inline-flex min-h-9 touch-manipulation items-center gap-2 text-xs text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-7',
        className
      )}
    >
      <span
        aria-hidden
        className={cn(
          'relative inline-flex h-4 w-7 shrink-0 rounded-full transition-colors',
          checked ? 'bg-primary' : 'bg-muted-foreground/30'
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-3 w-3 rounded-full bg-background shadow transition-transform',
            checked ? 'translate-x-3.5' : 'translate-x-0.5'
          )}
        />
      </span>
      <span>{label}</span>
    </button>
  );
}
