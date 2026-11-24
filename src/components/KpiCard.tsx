import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatCompactUSD, formatCompactNumber, formatPercentage, formatUSD } from '@/lib/format/number';

interface KpiCardProps {
  title: string;
  value: number | string | null;
  subtitle?: string;
  trend?: {
    value: number;
    isPositive: boolean;
  };
  isLoading?: boolean;
  format?: 'usd' | 'usd_full' | 'number' | 'percentage' | 'raw';
  compact?: boolean;
  className?: string;
  /** When set, the card is a button that opens a protocol-stat drill-down. */
  onClick?: () => void;
  selected?: boolean;
}

export function KpiCard({
  title,
  value,
  subtitle,
  trend,
  isLoading = false,
  format = 'usd',
  compact = false,
  className,
  onClick,
  selected = false,
}: KpiCardProps) {
  const formatValue = (val: number | string | null) => {
    if (val === null || val === undefined) return 'N/A';
    
    switch (format) {
      case 'usd':
        return formatCompactUSD(typeof val === 'string' ? parseFloat(val) : val);
			case 'usd_full':
				return formatUSD(typeof val === 'string' ? parseFloat(val) : val);
      case 'number':
        return formatCompactNumber(typeof val === 'string' ? parseFloat(val) : val);
      case 'percentage':
        return formatPercentage(typeof val === 'string' ? parseFloat(val) : val);
      default:
        return val.toString();
    }
  };

  const interactiveClass = onClick
    ? cn(
        'cursor-pointer transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected && 'ring-2 ring-ring bg-muted/60'
      )
    : undefined;

  if (isLoading) {
    return (
      <Card className={cn(compact ? 'py-3 gap-2 h-full' : 'h-full', className, interactiveClass)}>
        <CardHeader
          className={cn(
            'flex flex-row items-center justify-between space-y-0',
            compact ? 'pb-1 px-4' : 'pb-2'
          )}
        >
          <CardTitle className={compact ? 'text-xs font-medium' : 'text-sm font-medium'}>
            <Skeleton className={compact ? 'h-3 w-20' : 'h-4 w-24'} />
          </CardTitle>
        </CardHeader>
        <CardContent className={compact ? 'px-4 pt-0 flex-1' : 'flex-1'}>
          <div className={compact ? 'text-lg font-bold' : 'text-2xl font-bold'}>
            <Skeleton className={compact ? 'h-6 w-16' : 'h-8 w-20'} />
          </div>
          {subtitle && (
            <div className="text-xs text-muted-foreground mt-1">
              <Skeleton className={compact ? 'h-3 w-14' : 'h-3 w-16'} />
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  const body = (
    <>
      <CardHeader
        className={cn(
          'flex flex-row items-center justify-between space-y-0 shrink-0',
          compact ? 'pb-1 px-4' : 'pb-2'
        )}
      >
        <CardTitle className={compact ? 'text-xs font-medium' : 'text-sm font-medium'}>
          {title}
        </CardTitle>
        {trend && (
          <div
            className={cn(
              'text-xs font-medium',
              trend.isPositive ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
            )}
          >
            {trend.isPositive ? '+' : ''}
            {formatPercentage(trend.value)}
          </div>
        )}
      </CardHeader>
      <CardContent className={cn('flex flex-1 flex-col justify-center', compact ? 'px-4 pt-0' : undefined)}>
        <div className={cn(compact ? 'text-lg font-bold tabular-nums' : 'text-2xl font-bold tabular-nums')}>
          {formatValue(value)}
        </div>
        {subtitle && (
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{subtitle}</p>
        )}
        {onClick && (
          <p className="mt-1 hidden text-[10px] text-muted-foreground/80 sm:block">
            {selected ? 'Click to close' : 'Click for details'}
          </p>
        )}
      </CardContent>
    </>
  );

  if (onClick) {
    return (
      <Card
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick();
          }
        }}
        className={cn(
          compact ? 'py-3 gap-2 h-full flex flex-col' : 'h-full flex flex-col',
          className,
          interactiveClass
        )}
      >
        {body}
      </Card>
    );
  }

  return (
    <Card className={cn(compact ? 'py-3 gap-2 h-full flex flex-col' : 'h-full flex flex-col', className)}>
      {body}
    </Card>
  );
}
