'use client';

import '@rainbow-me/rainbowkit/styles.css';

import { useEffect, useState, type ReactNode } from 'react';
import { WagmiProvider, cookieToInitialState } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import { darkTheme, lightTheme, RainbowKitProvider } from '@rainbow-me/rainbowkit';
import { base } from 'wagmi/chains';
import { config } from '@/lib/wallet/config';
import { useTheme } from '@/lib/theme/ThemeContext';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { CuratorAuthProvider } from '@/lib/auth/CuratorAuthContext';
import { AuthGuard } from '@/components/AuthGuard';
import { ThemeProvider } from '@/lib/theme/ThemeContext';
import { RevenueSourceProvider } from '@/lib/RevenueSourceContext';

const ReactQueryDevtools = dynamic(
  () => import('@tanstack/react-query-devtools').then((mod) => mod.ReactQueryDevtools),
  { ssr: false }
);

import { CURATOR_REFETCH_INTERVAL_MS } from '@/lib/data/query-config';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 0,
      refetchInterval: CURATOR_REFETCH_INTERVAL_MS,
      refetchOnWindowFocus: true,
    },
  },
});

function resolveDark(theme: 'light' | 'dark' | 'system'): boolean {
  if (typeof window === 'undefined') return false;
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function RainbowKitThemeProvider({ children }: { children: ReactNode }) {
  const { theme } = useTheme();
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const update = () => setIsDark(resolveDark(theme));
    update();
    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      mq.addEventListener('change', update);
      return () => mq.removeEventListener('change', update);
    }
  }, [theme]);

  return (
    <RainbowKitProvider
      theme={isDark ? darkTheme() : lightTheme()}
      initialChain={base}
    >
      {children}
    </RainbowKitProvider>
  );
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
          <RainbowKitThemeProvider>
            <CuratorAuthProvider>
              <AuthGuard>
                <RevenueSourceProvider>
                  <ErrorBoundary>{children}</ErrorBoundary>
                </RevenueSourceProvider>
              </AuthGuard>
            </CuratorAuthProvider>
            {process.env.NODE_ENV === 'development' && (
              <ReactQueryDevtools initialIsOpen={false} />
            )}
          </RainbowKitThemeProvider>
        </WagmiProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
