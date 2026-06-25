'use client';

import {
  COINBASE_DEV_LINKS,
  INFRASTRUCTURE_DEV_LINKS,
} from '@/lib/constants';
import { ExternalLinkCard } from '@/components/overview/ExternalLinkCard';

export function DevelopmentLinksSection() {
  return (
    <>
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Coinbase
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {COINBASE_DEV_LINKS.map((item) => (
            <ExternalLinkCard key={item.url} {...item} />
          ))}
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          RPC &amp; WalletConnect
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {INFRASTRUCTURE_DEV_LINKS.map((item) => (
            <ExternalLinkCard key={item.url} {...item} />
          ))}
        </div>
      </div>
    </>
  );
}
