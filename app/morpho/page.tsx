'use client';

import Link from 'next/link';
import {
  ArrowRight,
  BookOpen,
  Bot,
  Droplets,
  ExternalLink,
  LayoutGrid,
  Plus,
  Shield,
  Sparkles,
} from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  MORPHO_APP_VAULTS_URL,
  MORPHO_AUTOMATION_BOTS,
  MORPHO_CURATOR_V2_VAULTS_URL,
  MORPHO_DOCS_GET_STARTED_URL,
  MORPHO_LIQUIDATION_APP_URL,
  MORPHO_ORACLE_PORTAL_URL,
} from '@/lib/constants';

type ExternalTool = {
  title: string;
  description: string;
  href: string;
  icon: typeof Shield;
};

const EXTERNAL_TOOLS: readonly ExternalTool[] = [
  {
    title: 'Morpho App — Vaults',
    description: 'Browse and deposit into Morpho vaults on app.morpho.org.',
    href: MORPHO_APP_VAULTS_URL,
    icon: LayoutGrid,
  },
  {
    title: 'Morpho Curator V2',
    description: 'Official Morpho curator UI for Vault V2 (caps, roles, emergency).',
    href: MORPHO_CURATOR_V2_VAULTS_URL,
    icon: Shield,
  },
  {
    title: 'Liquidation App',
    description: 'Morpho liquidation interface for Blue markets.',
    href: MORPHO_LIQUIDATION_APP_URL,
    icon: Droplets,
  },
  {
    title: 'Oracle Portal',
    description: 'Build, decode, and validate MorphoChainlink oracles before deploy.',
    href: MORPHO_ORACLE_PORTAL_URL,
    icon: Sparkles,
  },
  {
    title: 'Morpho Docs',
    description: 'Get started with Morpho — Earn, Borrow, curate, API, and SDK.',
    href: MORPHO_DOCS_GET_STARTED_URL,
    icon: BookOpen,
  },
];

export default function MorphoCuratorPage() {
  return (
    <AppShell
      title="Morpho Tools"
      description="Create Blue markets on-chain, open Morpho apps, and find automation bots."
    >
      <div className="mx-auto w-full max-w-3xl space-y-8">
        <Card className="overflow-hidden border-border/70">
          <CardHeader className="space-y-2 pb-3">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Plus className="h-3.5 w-3.5" />
              On-chain
            </div>
            <CardTitle className="text-xl">Create Morpho Blue market</CardTitle>
            <CardDescription className="max-w-xl text-sm leading-relaxed">
              Pick network in the top bar, paste loan/collateral + oracle, then call{' '}
              <code className="text-xs">Morpho.createMarket</code>. Validate feeds on the Oracle
              Portal first.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2 pb-5">
            <Button asChild>
              <Link href="/morpho/create-market" className="inline-flex items-center gap-2">
                Open create market
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="outline">
              <a
                href={MORPHO_ORACLE_PORTAL_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2"
              >
                Oracle Portal
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </Button>
          </CardContent>
        </Card>

        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">External Morpho links</h2>
            <p className="text-xs text-muted-foreground">
              Official Morpho surfaces. Curator vault writes stay in this app.
            </p>
          </div>
          <Card className="border-border/70">
            <CardContent className="divide-y divide-border/60 p-0">
              {EXTERNAL_TOOLS.map((tool) => {
                const Icon = tool.icon;
                return (
                  <a
                    key={tool.href}
                    href={tool.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
                  >
                    <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border/60 bg-muted/50">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                        {tool.title}
                        <ExternalLink className="h-3 w-3 text-muted-foreground" />
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {tool.description}
                      </span>
                    </span>
                  </a>
                );
              })}
            </CardContent>
          </Card>
        </section>

        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Automation bots</h2>
            <p className="text-xs text-muted-foreground">
              Morpho open-source bots for liquidations and Vault V2 reallocation.
            </p>
          </div>
          <Card className="border-border/70">
            <CardContent className="divide-y divide-border/60 p-0">
              {MORPHO_AUTOMATION_BOTS.map((bot) => (
                <a
                  key={bot.href}
                  href={bot.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
                >
                  <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border/60 bg-muted/50">
                    <Bot className="h-4 w-4 text-muted-foreground" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                      {bot.title}
                      <ExternalLink className="h-3 w-3 text-muted-foreground" />
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {bot.description}
                    </span>
                  </span>
                </a>
              ))}
            </CardContent>
          </Card>
        </section>
      </div>
    </AppShell>
  );
}
