'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ExternalLink } from 'lucide-react';
import type { ExternalLinkItem } from '@/lib/constants';

export function ExternalLinkCard({
  name,
  url,
  description,
  displayText,
}: ExternalLinkItem) {
  const buttonLabel =
    displayText ?? url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');

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
