'use client';

import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ExternalLink } from 'lucide-react';
import { formatAddress } from '@/lib/format/number';
import { getRoleAddressLabel } from '@/lib/format/address-label';
import { CopyButton } from '@/components/CopyButton';

interface AddressBadgeProps {
  address: string;
  scanUrl?: string;
  showCopy?: boolean;
  className?: string;
  truncate?: boolean;
  /** Show a role label (`auto` = Public Allocator / Safe / EOA). */
  label?: string | 'auto';
}

export function AddressBadge({
  address,
  scanUrl,
  showCopy = true,
  className,
  truncate = true,
  label,
}: AddressBadgeProps) {
  const resolvedLabel = useMemo(() => {
    if (label === 'auto') return getRoleAddressLabel(address);
    return label;
  }, [address, label]);

  return (
    <span className={`inline-flex flex-wrap items-center gap-1.5 ${className ?? ''}`}>
      {resolvedLabel ? (
        <Badge variant="outline" className="text-[10px] font-medium">
          {resolvedLabel}
        </Badge>
      ) : null}
      <Badge variant="secondary" className="font-mono text-xs">
        {truncate ? formatAddress(address) : address}
      </Badge>

      {showCopy ? <CopyButton text={address} /> : null}

      {scanUrl ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => window.open(scanUrl, '_blank')}
          className="h-6 w-6 p-0"
          title="View on explorer"
          aria-label="View on explorer"
        >
          <ExternalLink className="h-3 w-3" />
        </Button>
      ) : null}
    </span>
  );
}
