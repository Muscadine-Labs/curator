import { afterEach, describe, expect, it, vi } from 'vitest';
import { publicClient } from '@/lib/onchain/client';
import { resolveBasenames } from '@/lib/onchain/basename';

vi.mock('@/lib/onchain/client', () => ({
  publicClient: {
    multicall: vi.fn(),
  },
}));

const ACCOUNT = '0xD437c78a6bA1F42Dca908F3759ab8B8A42Af4D82' as const;
const NODE = `0x${'ab'.repeat(32)}` as const;
const RESOLVER = '0x426fA03fB86E510d0Dd9F70335Cf102a98b10875' as const;
const OTHER = '0x1111111111111111111111111111111111111111' as const;

describe('resolveBasenames', () => {
  afterEach(() => {
    vi.mocked(publicClient.multicall).mockReset();
  });

  it('returns the Basename for an address that has one', async () => {
    vi.mocked(publicClient.multicall)
      .mockResolvedValueOnce([{ status: 'success', result: NODE }] as never)
      .mockResolvedValueOnce([{ status: 'success', result: 'nick.base.eth' }] as never)
      .mockResolvedValueOnce([{ status: 'success', result: RESOLVER }] as never)
      .mockResolvedValueOnce([{ status: 'success', result: ACCOUNT }] as never);
    const names = await resolveBasenames([ACCOUNT]);
    expect(names.get(ACCOUNT.toLowerCase())).toBe('nick.base.eth');
  });

  it('omits a reverse name that does not resolve back to the address', async () => {
    vi.mocked(publicClient.multicall)
      .mockResolvedValueOnce([{ status: 'success', result: NODE }] as never)
      .mockResolvedValueOnce([{ status: 'success', result: 'muscadine.base.eth' }] as never)
      .mockResolvedValueOnce([{ status: 'success', result: RESOLVER }] as never)
      .mockResolvedValueOnce([{ status: 'success', result: OTHER }] as never);
    const names = await resolveBasenames([ACCOUNT]);
    expect(names.size).toBe(0);
  });

  it('omits an address with an empty Basename', async () => {
    vi.mocked(publicClient.multicall)
      .mockResolvedValueOnce([{ status: 'success', result: NODE }] as never)
      .mockResolvedValueOnce([{ status: 'success', result: '  ' }] as never);
    const names = await resolveBasenames([ACCOUNT]);
    expect(names.size).toBe(0);
  });

  it('returns nothing when the registrar call fails', async () => {
    vi.mocked(publicClient.multicall).mockRejectedValueOnce(new Error('rpc'));
    const names = await resolveBasenames([ACCOUNT]);
    expect(names.size).toBe(0);
  });
});