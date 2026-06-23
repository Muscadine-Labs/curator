'use client';

import { AppShell } from '@/components/layout/AppShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ExternalLink } from 'lucide-react';
import { DevelopmentLinksSection } from '@/components/overview/DevelopmentLinksSection';
import {
  MUSCADINE_BUSINESS_SERVICES,
  MUSCADINE_DEVELOPMENT_LINKS,
  MUSCADINE_DOMAINS,
  type ExternalLinkItem,
} from '@/lib/constants';

function LinkCard({
  name,
  url,
  description,
  displayText,
}: ExternalLinkItem) {
  const buttonLabel = displayText ?? url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle className="text-center text-base">{name}</CardTitle>
        <p className="text-center text-xs text-slate-500 dark:text-slate-400">
          {description}
        </p>
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

export default function MuscadinePagesPage() {
  return (
    <AppShell
      title="Muscadine Pages"
      description="Quick links to Muscadine domains, development, and business services."
    >
      <div className="space-y-8">
        <div>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Muscadine Domains
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {MUSCADINE_DOMAINS.map((item) => (
              <LinkCard key={item.url} {...item} />
            ))}
          </div>
        </div>

        <div>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            GitHub, Vercel & Google Drive
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {MUSCADINE_DEVELOPMENT_LINKS.map((item) => (
              <LinkCard key={item.url} {...item} />
            ))}
          </div>
        </div>

        <div>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Business Services
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {MUSCADINE_BUSINESS_SERVICES.map((item) => (
              <LinkCard key={item.url} {...item} />
            ))}
          </div>
        </div>

        <DevelopmentLinksSection />
      </div>
    </AppShell>
  );
}
