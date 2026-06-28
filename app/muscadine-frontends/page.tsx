'use client';

import { AppShell } from '@/components/layout/AppShell';
import { ExternalLinkCard } from '@/components/overview/ExternalLinkCard';
import { DevelopmentLinksSection } from '@/components/overview/DevelopmentLinksSection';
import {
  MUSCADINE_BUSINESS_SERVICES,
  MUSCADINE_DEVELOPMENT_LINKS,
  MUSCADINE_DOMAINS,
  MUSCADINE_SAFE_LINKS,
} from '@/lib/constants';

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
              <ExternalLinkCard key={item.url} {...item} />
            ))}
          </div>
        </div>

        <div>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            GitHub, Vercel & Google Drive
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {MUSCADINE_DEVELOPMENT_LINKS.map((item) => (
              <ExternalLinkCard key={item.url} {...item} />
            ))}
          </div>
        </div>

        <div>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Business Services
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {MUSCADINE_BUSINESS_SERVICES.map((item) => (
              <ExternalLinkCard key={item.url} {...item} />
            ))}
          </div>
        </div>

        <div>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Safe &amp; Multisig
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {MUSCADINE_SAFE_LINKS.map((item) => (
              <ExternalLinkCard key={item.url} {...item} />
            ))}
          </div>
        </div>

        <DevelopmentLinksSection />
      </div>
    </AppShell>
  );
}
