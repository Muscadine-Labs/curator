'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ExternalLink } from 'lucide-react';
import {
  COINBASE_DEV_LINKS,
  INFRASTRUCTURE_DEV_LINKS,
  type ExternalLinkItem,
} from '@/lib/constants';

function DevLinkCard({ name, url, description, displayText }: ExternalLinkItem) {
  const buttonLabel = displayText ?? url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle className="text-center text-base">{name}</CardTitle>
        <p className="text-center text-xs text-slate-500 dark:text-slate-400">{description}</p>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col items-center justify-center">
        <Button asChild variant="outline" size="lg" className="w-full">
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2"
          >
            {buttonLabel}
            <ExternalLink className="h-4 w-4 shrink-0" />
          </a>
        </Button>
      </CardContent>
    </Card>
  );
}

export function DevelopmentLinksSection() {
  return (
    <>
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Coinbase
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {COINBASE_DEV_LINKS.map((item) => (
            <DevLinkCard key={item.url} {...item} />
          ))}
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          RPC &amp; WalletConnect
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {INFRASTRUCTURE_DEV_LINKS.map((item) => (
            <DevLinkCard key={item.url} {...item} />
          ))}
        </div>
      </div>
    </>
  );
}
