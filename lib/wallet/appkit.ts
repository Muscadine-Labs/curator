'use client';

import { createAppKit } from '@reown/appkit/react';
import { metadata, networks, projectId, wagmiAdapter } from '@/lib/wallet/config';

/** WalletGuide IDs — https://docs.reown.com/cloud/wallets/wallet-list */
const WALLET_IDS = {
  rabby: '18388be9ac2d02726dbac9777c96efaac06d744b2f6d580fccdd4127a6d01fd1',
  metamask: 'c57ca95b47569778a828d19178114f4db188b89b763c899ba0be274e97267d96',
  /** Base app (formerly Coinbase Wallet) */
  base: 'fd20dc426fb37566d803205b19bbc1d4096b248ac04548e3cfb6b3a38bd033aa',
  phantom: 'a797aa35c0fadbfc1a53e7f675162ed5226968b44a19ee3d24385c64d1d3c393',
} as const;

/**
 * Reown AppKit modal. SIWE/SIWX is omitted — connecting must not prompt a
 * signature. Email/social and dashboard Reown Authentication stay off.
 *
 * Reown Cloud can still enable `reownAuthentication` remotely; we strip that
 * after remote config loads.
 */
const appKit = createAppKit({
  adapters: [wagmiAdapter],
  projectId,
  networks,
  defaultNetwork: networks[0],
  metadata,
  defaultAccountTypes: { eip155: 'eoa' },
  enableEIP6963: true,
  enableInjected: true,
  enableCoinbase: true,
  enableBaseAccount: true,
  enableWallets: true,
  allWallets: 'SHOW',
  featuredWalletIds: [
    WALLET_IDS.rabby,
    WALLET_IDS.metamask,
    WALLET_IDS.base,
    WALLET_IDS.phantom,
  ],
  features: {
    // Off: no optional usage analytics. AppKit still sends its mandatory INITIALIZE and
    // CONNECT_SUCCESS events and wallet-list impressions to Reown; those cannot be disabled.
    analytics: false,
    email: false,
    socials: false,
    swaps: false,
    onramp: false,
    history: false,
    smartSessions: false,
    reownAuthentication: false,
    connectMethodsOrder: ['wallet'],
  },
  themeMode: 'dark',
  themeVariables: {
    '--apkt-accent': 'var(--primary)',
    '--apkt-border-radius-master': '4px',
    '--apkt-z-index': 100000,
    // `inherit`: the modal is mounted under <body> and uses the page font. A var(--font-…)
    // value would not work (AppKit declares it on :root, where next/font's variable is
    // undefined). Any custom value also stops AppKit preloading its own fonts from
    // fonts.reown.com on every page load (an IP-visible third-party request).
    '--apkt-font-family': 'inherit',
    '--w3m-accent': 'var(--primary)',
    '--w3m-border-radius-master': '4px',
    '--w3m-z-index': 100000,
    '--w3m-font-family': 'inherit',
  },
});

function stripSiwx() {
  const remote = appKit.getRemoteFeatures();
  const hasRemoteAuth =
    remote?.reownAuthentication ||
    remote?.email ||
    (Array.isArray(remote?.socials) && remote.socials.length > 0);
  if (hasRemoteAuth) {
    appKit.updateRemoteFeatures({
      reownAuthentication: false,
      email: false,
      socials: false,
    });
  }
  if (appKit.getSIWX()) {
    appKit.updateOptions({ siwx: undefined });
  }
}

appKit.subscribeRemoteFeatures(stripSiwx);
stripSiwx();
