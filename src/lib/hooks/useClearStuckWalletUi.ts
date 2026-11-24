'use client';

import { useEffect } from 'react';

/**
 * Returning to a WebView (or after an AppKit overlay) can leave body scroll
 * locked with no modal actually open. On pageshow, drop leftover WC/AppKit
 * chrome unless a real dialog is visible.
 */
export function useClearStuckWalletUi() {
  useEffect(() => {
    const restore = () => {
      const dialogOpen = Boolean(
        document.querySelector(
          'w3m-modal[open], appkit-modal[open], wcm-modal[open], [role="dialog"][aria-modal="true"]'
        )
      );
      if (dialogOpen) return;

      document.body.style.removeProperty('overflow');
      document.body.style.removeProperty('pointer-events');
      document.documentElement.style.removeProperty('overflow');
      document.documentElement.style.removeProperty('pointer-events');
    };

    let timeoutId: number | undefined;
    const onReturn = () => {
      window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(restore, 50);
    };

    restore();
    document.addEventListener('visibilitychange', onReturn);
    window.addEventListener('pageshow', onReturn);

    return () => {
      window.clearTimeout(timeoutId);
      document.removeEventListener('visibilitychange', onReturn);
      window.removeEventListener('pageshow', onReturn);
    };
  }, []);
}
