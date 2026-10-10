import { describe, expect, it } from 'vitest';
import { coinbaseWalletForAppKit } from '@/lib/wallet/coinbase-connector';

describe('coinbaseWalletForAppKit', () => {
  it('uses the connector id AppKit checks before adding a default', () => {
    const create = coinbaseWalletForAppKit({
      appName: 'Muscadine Curator',
      appLogoUrl: 'https://example.com/logo.jpg',
    });
    const connector = create({} as Parameters<typeof create>[0]);
    expect(connector.id).toBe('coinbaseWallet');
  });
});
