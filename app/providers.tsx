'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { WagmiProvider, cookieToInitialState, type Config } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import { createAppKit, useAppKitTheme } from '@reown/appkit/react';
import {
  appKitMetadata,
  networks,
  projectId,
  wagmiAdapter,
} from '@/lib/wallet/config';
import { useTheme } from '@/lib/theme/ThemeContext';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { CuratorAuthProvider } from '@/lib/auth/CuratorAuthContext';
import { AuthGuard } from '@/components/AuthGuard';
import { ThemeProvider } from '@/lib/theme/ThemeContext';
import { RevenueSourceProvider } from '@/lib/RevenueSourceContext';
import { base } from '@reown/appkit/networks';

const ReactQueryDevtools = dynamic(
  () => import('@tanstack/react-query-devtools').then((mod) => mod.ReactQueryDevtools),
  { ssr: false }
);

createAppKit({
  adapters: [wagmiAdapter],
  projectId,
  networks,
  defaultNetwork: base,
  metadata: appKitMetadata,
  // Rabby and other browser extensions register via EIP-6963 (not WalletConnect QR).
  enableEIP6963: true,
  enableInjected: true,
  enableNetworkSwitch: true,
  features: {
    analytics: false,
    email: false,
    socials: false,
  },
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
    },
  },
});

function resolveDark(theme: 'light' | 'dark' | 'system'): boolean {
  if (typeof window === 'undefined') return false;
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function AppKitThemeSync() {
  const { theme } = useTheme();
  const { setThemeMode } = useAppKitTheme();

  useEffect(() => {
    const update = () => setThemeMode(resolveDark(theme) ? 'dark' : 'light');
    update();
    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      mq.addEventListener('change', update);
      return () => mq.removeEventListener('change', update);
    }
  }, [theme, setThemeMode]);

  return null;
}

export function Providers({
  children,
  cookies,
}: {
  children: ReactNode;
  cookies: string | null;
}) {
  const initialState = cookieToInitialState(wagmiAdapter.wagmiConfig as Config, cookies);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <WagmiProvider
          config={wagmiAdapter.wagmiConfig}
          initialState={initialState}
          reconnectOnMount
        >
          <AppKitThemeSync />
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
        </WagmiProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
