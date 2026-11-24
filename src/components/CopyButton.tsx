'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCopyFeedback } from '@/components/CopyFeedbackProvider';
import { cn } from '@/lib/utils';

type CopyButtonProps = {
  text: string;
  message?: string;
  title?: string;
  className?: string;
  iconClassName?: string;
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
};

export function CopyButton({
  text,
  message = 'Copied address',
  title = 'Copy address',
  className,
  iconClassName,
  onClick,
}: CopyButtonProps) {
  const { copyToClipboard } = useCopyFeedback();
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    };
  }, []);

  const handleClick = async (event: React.MouseEvent<HTMLButtonElement>) => {
    onClick?.(event);
    if (event.defaultPrevented) return;

    const ok = await copyToClipboard(text, message);
    if (!ok) return;

    setCopied(true);
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    resetTimerRef.current = setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      title={copied ? 'Copied' : title}
      aria-label={copied ? 'Copied' : title}
      onClick={(event) => {
        void handleClick(event);
      }}
      className={cn(
        'h-6 w-6 p-0 transition-colors',
        copied && 'bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-400',
        className
      )}
    >
      {copied ? (
        <Check className={cn('h-3 w-3', iconClassName)} />
      ) : (
        <Copy className={cn('h-3 w-3', iconClassName)} />
      )}
    </Button>
  );
}
