function normalizeOrigin(url: string): string {
  return url.replace(/\/$/, '');
}

/** Public origin for WalletConnect / Reown AppKit metadata. */
export function getAppUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (fromEnv) return normalizeOrigin(fromEnv);

  if (typeof window !== 'undefined') {
    return window.location.origin;
  }

  if (process.env.NODE_ENV === 'development') {
    return 'http://localhost:3001';
  }

  return 'https://curator.muscadine.xyz';
}
