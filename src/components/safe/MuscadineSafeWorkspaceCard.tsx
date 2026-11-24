'use client';

import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MUSCADINE_SAFE_SPACE_URL } from '@/lib/constants';

export function MuscadineSafeWorkspaceCard() {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border px-4 py-3">
      <p className="text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Muscadine</span>
        {' · '}
        Safe workspace for all vault-role multisigs
      </p>
      <Button asChild variant="outline" size="sm" className="h-7 shrink-0 px-2 text-xs">
        <a
          href={MUSCADINE_SAFE_SPACE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5"
        >
          Open workspace
          <ExternalLink className="h-3 w-3" />
        </a>
      </Button>
    </div>
  );
}
