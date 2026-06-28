'use client';

import { AppShell } from '@/components/layout/AppShell';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ExternalLink } from 'lucide-react';
import {
  MORPHO_AUTOMATION_BOTS,
  MORPHO_CURATOR_V1_URL,
  MORPHO_CURATOR_V2_VAULTS_URL,
} from '@/lib/constants';

export default function MorphoCuratorPage() {
  return (
    <AppShell
      title="Morpho Tools"
      description="Access Morpho interfaces and automated bots for vault management."
    >
      <div className="space-y-6">
        <div className="grid max-w-2xl grid-cols-1 gap-4 sm:grid-cols-2">
          <Card className="flex flex-col">
            <CardHeader>
              <CardTitle className="text-center">Vault V1</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col items-center justify-center">
              <Button asChild variant="outline" size="lg" className="w-full">
                <a
                  href={MORPHO_CURATOR_V1_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2"
                >
                  Open Vault V1
                  <ExternalLink className="h-4 w-4" />
                </a>
              </Button>
            </CardContent>
          </Card>

          <Card className="flex flex-col">
            <CardHeader>
              <CardTitle className="text-center">Vault V2</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col items-center justify-center">
              <Button asChild variant="outline" size="lg" className="w-full">
                <a
                  href={MORPHO_CURATOR_V2_VAULTS_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2"
                >
                  Open Vault V2
                  <ExternalLink className="h-4 w-4" />
                </a>
              </Button>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            Morpho Automated Bots
          </h2>
          <div className="grid gap-4 lg:grid-cols-3">
            {MORPHO_AUTOMATION_BOTS.map((bot) => (
              <Card key={bot.href}>
                <CardHeader>
                  <CardTitle className="text-base">{bot.title}</CardTitle>
                  <CardDescription>{bot.description}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm text-slate-600 dark:text-slate-400">{bot.body}</p>
                  <Button asChild variant="default" className="w-full sm:w-auto">
                    <a
                      href={bot.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2"
                    >
                      View on GitHub
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
