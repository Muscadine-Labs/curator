import { describe, expect, it } from 'vitest';
import { zeroAddress } from 'viem';
import {
  capitalInflowTokens,
  isPrincipalCapitalInflow,
} from '@/lib/morpho/treasury-transfers';

const OTHER = '0x1111111111111111111111111111111111111111';

describe('isPrincipalCapitalInflow', () => {
  it('treats a deposit on behalf of the treasury as capital', () => {
    expect(
      isPrincipalCapitalInflow({
        direction: 'in',
        type: 'Deposit',
        counterparty: OTHER,
      })
    ).toBe(true);
  });

  it('treats an inbound share transfer from another wallet as capital', () => {
    expect(
      isPrincipalCapitalInflow({
        direction: 'in',
        type: 'Transfer',
        counterparty: OTHER,
      })
    ).toBe(true);
  });

  it('keeps a fee-share mint from address(0)', () => {
    expect(
      isPrincipalCapitalInflow({
        direction: 'in',
        type: 'Transfer',
        counterparty: zeroAddress,
      })
    ).toBe(false);
  });

  it('does not treat outflows as capital inflows', () => {
    expect(
      isPrincipalCapitalInflow({
        direction: 'out',
        type: 'Withdraw',
        counterparty: OTHER,
      })
    ).toBe(false);
    expect(
      isPrincipalCapitalInflow({
        direction: 'out',
        type: 'Transfer',
        counterparty: OTHER,
      })
    ).toBe(false);
  });
});

describe('capitalInflowTokens', () => {
  it('uses indexed underlying assets when present', () => {
    expect(
      capitalInflowTokens({
        assetsRaw: '1500000',
        assetDecimals: 6,
        sharesRaw: '1',
        dayShares: 10n,
        dayTokens: 100,
      })
    ).toBe(1.5);
  });

  it('values a share-only transfer from that day’s assets per share', () => {
    expect(
      capitalInflowTokens({
        assetsRaw: null,
        assetDecimals: 6,
        sharesRaw: '25',
        dayShares: 100n,
        dayTokens: 400,
      })
    ).toBe(100);
  });

  it('returns 0 when a share-only transfer has no day balance to price it', () => {
    expect(
      capitalInflowTokens({
        assetsRaw: null,
        assetDecimals: 6,
        sharesRaw: '25',
        dayShares: null,
        dayTokens: 0,
      })
    ).toBe(0);
  });
});
