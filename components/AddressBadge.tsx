import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Copy, ExternalLink } from 'lucide-react';
import { formatAddress } from '@/lib/format/number';
import { logger } from '@/lib/utils/logger';

interface AddressBadgeProps {
  address: string;
  scanUrl?: string;
  showCopy?: boolean;
  className?: string;
  truncate?: boolean;
}

export function AddressBadge({ 
  address, 
  scanUrl, 
  showCopy = true, 
  className,
  truncate = true,
}: AddressBadgeProps) {

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(address);
    } catch (err) {
      logger.error('Failed to copy address', err instanceof Error ? err : new Error(String(err)), {
        address,
      });
    }
  };

  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ''}`}>
      <Badge variant="secondary" className="font-mono text-xs">
        {truncate ? formatAddress(address) : address}
      </Badge>
      
      {showCopy && (
        <Button
          variant="ghost"
          size="sm"
          onClick={handleCopy}
          className="h-6 w-6 p-0"
        >
          <Copy className="h-3 w-3" />
        </Button>
      )}
      
      {scanUrl && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => window.open(scanUrl, '_blank')}
          className="h-6 w-6 p-0"
        >
          <ExternalLink className="h-3 w-3" />
        </Button>
      )}
    </span>
  );
}
