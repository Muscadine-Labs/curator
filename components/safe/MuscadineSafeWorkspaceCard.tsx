'use client';

import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MUSCADINE_SAFE_SPACE_URL } from '@/lib/constants';

export function MuscadineSafeWorkspaceCard() {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2 dark:border-slate-800 dark:bg-slate-900/40">
      <p className="text-xs text-slate-600 dark:text-slate-400">
        <span className="font-medium text-slate-800 dark:text-slate-200">Muscadine Labs</span>
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
