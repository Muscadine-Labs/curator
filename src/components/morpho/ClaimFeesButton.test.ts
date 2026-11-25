import { describe, expect, it } from 'vitest';
import { claimFeesMessage } from './ClaimFeesButton';

describe('claimFeesMessage', () => {
  it('states the amount and the vault', () => {
    expect(claimFeesMessage('2.198 USDC', 'USDC Prime', 2198432n)).toBe(
      'This will claim 2.198 USDC of fees on USDC Prime.'
    );
  });

  it('says when nothing is claimable', () => {
    expect(claimFeesMessage('0 USDC', 'USDC Prime', 0n)).toBe(
      'There are no fees to claim on USDC Prime.'
    );
  });
});
