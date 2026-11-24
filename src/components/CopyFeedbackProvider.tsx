'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { logger } from '@/lib/utils/logger';

type CopyFeedbackContextValue = {
  copyToClipboard: (text: string, message?: string) => Promise<boolean>;
};

const CopyFeedbackContext = createContext<CopyFeedbackContextValue | null>(null);

export function useCopyFeedback(): CopyFeedbackContextValue {
  const ctx = useContext(CopyFeedbackContext);
  if (!ctx) {
    throw new Error('useCopyFeedback must be used within CopyFeedbackProvider');
  }
  return ctx;
}

export function CopyFeedbackProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ message: string; ok: boolean } | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  const showToast = useCallback((message: string, ok: boolean) => {
    setToast({ message, ok });
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setToast(null), 2200);
  }, []);

  const copyToClipboard = useCallback(async (text: string, message = 'Copied address') => {
    try {
      await navigator.clipboard.writeText(text);
      showToast(message, true);
      return true;
    } catch (err) {
      logger.error('Failed to copy to clipboard', err instanceof Error ? err : new Error(String(err)));
      showToast('Failed to copy', false);
      return false;
    }
  }, [showToast]);

  return (
    <CopyFeedbackContext.Provider value={{ copyToClipboard }}>
      {children}
      <div
        aria-live="polite"
        className={cn(
          'pointer-events-none fixed inset-x-0 bottom-6 z-[100] flex justify-center px-4 transition-all duration-200',
          toast ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
        )}
      >
        {toast ? (
          <div
            className={cn(
              'inline-flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium shadow-lg',
              toast.ok
                ? 'border-emerald-500/30 bg-emerald-50 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-950 dark:text-emerald-200'
                : 'border-red-500/30 bg-red-50 text-red-800 dark:border-red-500/40 dark:bg-red-950 dark:text-red-200'
            )}
          >
            {toast.ok ? (
              <Check className="h-4 w-4 shrink-0" aria-hidden />
            ) : (
              <X className="h-4 w-4 shrink-0" aria-hidden />
            )}
            <span>{toast.message}</span>
          </div>
        ) : null}
      </div>
    </CopyFeedbackContext.Provider>
  );
}
