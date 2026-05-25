'use client';

import { AppShell } from '@/components/layout/AppShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ExternalLink } from 'lucide-react';

export default function FrontendPage() {
  return (
    <AppShell
      title="Development"
      description="Quick links to Coinbase, development, RPC, and wallet connect."
    >
      <div className="space-y-6">
        {/* Coinbase - first row */}
        <div>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Coinbase
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Card className="flex flex-col">
              <CardHeader>
                <CardTitle className="text-center text-base">Base Build</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col items-center justify-center">
                <Button
                  asChild
                  variant="outline"
                  size="lg"
                  className="w-full"
                >
                  <a
                    href="https://www.base.dev/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2"
                  >
                    base.dev
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </Button>
              </CardContent>
            </Card>
            <Card className="flex flex-col">
              <CardHeader>
                <CardTitle className="text-center text-base">CDP Portal</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col items-center justify-center">
                <Button
                  asChild
                  variant="outline"
                  size="lg"
                  className="w-full"
                >
                  <a
                    href="https://portal.cdp.coinbase.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2"
                  >
                    portal.cdp.coinbase.com
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Development */}
        <div>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Development
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Card className="flex flex-col">
              <CardHeader>
                <CardTitle className="text-center text-base">GitHub</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col items-center justify-center">
                <Button
                  asChild
                  variant="outline"
                  size="lg"
                  className="w-full"
                >
                  <a
                    href="https://github.com/Muscadine-Labs"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2"
                  >
                    Muscadine-Labs
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* RPC, Wallet Connect Reown */}
        <div>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            RPC, Wallet Connect
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Card className="flex flex-col">
              <CardHeader>
                <CardTitle className="text-center text-base">RPC</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col items-center justify-center">
                <Button
                  asChild
                  variant="outline"
                  size="lg"
                  className="w-full"
                >
                  <a
                    href="https://dashboard.alchemy.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2"
                  >
                    Alchemy Dashboard
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </Button>
              </CardContent>
            </Card>
            <Card className="flex flex-col">
              <CardHeader>
                <CardTitle className="text-center text-base">WalletConnect Cloud</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col items-center justify-center">
                <Button
                  asChild
                  variant="outline"
                  size="lg"
                  className="w-full"
                >
                  <a
                    href="https://cloud.walletconnect.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2"
                  >
                    WalletConnect Cloud
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
