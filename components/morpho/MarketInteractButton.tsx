'use client';

import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { morphoMidnightMarketHref, morphoMarketHref } from '@/lib/morpho/morpho-app-links';

type MarketInteractButtonProps = {
  product: 'blue' | 'midnight';
  marketId: string;
  chainId: number;
  className?: string;
};

/** Opens Morpho’s app. Lend/borrow/deposit writes live in muscadine-onchain. */
export function MarketInteractButton({
  product,
  marketId,
  chainId,
  className,
}: MarketInteractButtonProps) {
  const href =
    product === 'blue'
      ? morphoMarketHref(marketId, chainId)
      : morphoMidnightMarketHref(marketId, chainId);
  if (!href) return null;
  return (
    <Button size="sm" variant="outline" className={className} asChild>
      <a href={href} target="_blank" rel="noopener noreferrer">
        {product === 'blue' ? 'Morpho app' : 'Trade on Morpho'}
        <ExternalLink className="ml-1.5 h-4 w-4" />
      </a>
    </Button>
  );
}
