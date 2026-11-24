'use client';

import { useEffect, type ReactNode } from 'react';
import { WagmiProvider, cookieToInitialState } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import { config } from '@/lib/wallet/config';
import '@/lib/wallet/appkit';
import { useAppKitTheme } from '@reown/appkit/react';
import { useTheme, ThemeProvider } from '@/lib/theme/ThemeContext';
import { CopyFeedbackProvider } from '@/components/CopyFeedbackProvider';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { CuratorAuthProvider } from '@/lib/auth/CuratorAuthContext';
import { AuthGuard } from '@/components/AuthGuard';
import { RevenueSourceProvider } from '@/lib/RevenueSourceContext';
import { CuratorNetworkProvider } from '@/lib/network/CuratorNetworkContext';

const ReactQueryDevtools = dynamic(
  () => import('@tanstack/react-query-devtools').then((mod) => mod.ReactQueryDevtools),
  { ssr: false }
);

import {
  CURATOR_DEFAULT_STALE_MS,
  shouldRetryCuratorQuery,
} from '@/lib/data/query-config';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: CURATOR_DEFAULT_STALE_MS,
      refetchInterval: false,
      refetchOnWindowFocus: false,
      retry: shouldRetryCuratorQuery,
    },
  },
});

function AppKitThemeSync() {
  const { resolvedTheme } = useTheme();
  const { setThemeMode } = useAppKitTheme();

  useEffect(() => {
    setThemeMode(resolvedTheme);
  }, [resolvedTheme, setThemeMode]);

  return null;
}

export function Providers({
  children,
  cookies,
}: {
  children: ReactNode;
  cookies: string | null;
}) {
  const initialState = cookieToInitialState(config, cookies);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <WagmiProvider config={config} initialState={initialState} reconnectOnMount>
          <AppKitThemeSync />
          <CuratorNetworkProvider>
            <CuratorAuthProvider>
              <AuthGuard>
                <RevenueSourceProvider>
                  <CopyFeedbackProvider>
                    <ErrorBoundary>{children}</ErrorBoundary>
                  </CopyFeedbackProvider>
                </RevenueSourceProvider>
              </AuthGuard>
            </CuratorAuthProvider>
          </CuratorNetworkProvider>
          {process.env.NODE_ENV === 'development' && (
            <ReactQueryDevtools initialIsOpen={false} />
          )}
        </WagmiProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
