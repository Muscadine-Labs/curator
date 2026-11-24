'use client';

import { ExternalLink } from 'lucide-react';
import { formatAddress } from '@/lib/format/number';
import { getAddressScanUrl, getScanUrlForChain } from '@/lib/constants';

const LINK_CLASS =
  'inline-flex items-center gap-1 font-mono text-xs text-blue-600 hover:underline dark:text-blue-400';

/** Truncated address linking to the chain's block explorer. */
export function ExplorerAddressLink({ address, chainId }: { address: string; chainId: number }) {
  return (
    <a
      href={getAddressScanUrl(chainId, address)}
      target="_blank"
      rel="noopener noreferrer"
      className={LINK_CLASS}
    >
      {formatAddress(address)}
      <ExternalLink className="h-3 w-3 shrink-0" />
    </a>
  );
}

/** Truncated tx hash linking to the chain's block explorer. */
export function ExplorerTxLink({ hash, chainId }: { hash: string; chainId: number }) {
  return (
    <a
      href={`${getScanUrlForChain(chainId)}/tx/${hash}`}
      target="_blank"
      rel="noopener noreferrer"
      className={LINK_CLASS}
    >
      {formatAddress(hash)}
      <ExternalLink className="h-3 w-3 shrink-0" />
    </a>
  );
}
