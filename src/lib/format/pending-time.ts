import { format } from 'date-fns';

function pluralize(value: number, unit: string): string {
  return `${value} ${unit}${value === 1 ? '' : 's'}`;
}

/** Human-readable timelock executable time with day/hour/minute precision. */
export function formatExecutableAt(timestampSec: number, nowMs: number = Date.now()): string {
  if (!timestampSec) return '—';

  const targetMs = timestampSec * 1000;

  if (targetMs <= nowMs) {
    return `since ${format(new Date(targetMs), 'MMM d, yyyy HH:mm')}`;
  }

  const totalMinutes = Math.floor((targetMs - nowMs) / 60_000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(pluralize(days, 'day'));
  if (hours > 0) parts.push(pluralize(hours, 'hour'));
  if (minutes > 0 || parts.length === 0) parts.push(pluralize(minutes, 'minute'));

  return `in ${parts.join(', ')}`;
}
