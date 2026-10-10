import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Address } from 'viem';

const safeContractRead = vi.fn();

vi.mock('@/lib/onchain/client', () => ({
  safeContractRead: (...args: unknown[]) => safeContractRead(...args),
}));

import { getIRMTargetUtilizationWithFallback } from './irm-utils';

const ADAPTIVE_CURVE_IRM = '0x46415998764C29aB2a25CbeA6254146D50D22687' as Address;

describe('getIRMTargetUtilizationWithFallback', () => {
  beforeEach(() => {
    safeContractRead.mockReset();
  });

  it('uses the Adaptive Curve IRM 90% target without an RPC read', async () => {
    await expect(getIRMTargetUtilizationWithFallback(ADAPTIVE_CURVE_IRM)).resolves.toBe(0.9);
    expect(safeContractRead).not.toHaveBeenCalled();
  });

  it('reads kink() once for another IRM and reuses the result', async () => {
    const irm = '0x1111111111111111111111111111111111111111' as Address;
    safeContractRead.mockResolvedValue(800000000000000000n);

    await expect(getIRMTargetUtilizationWithFallback(irm)).resolves.toBe(0.8);
    await expect(getIRMTargetUtilizationWithFallback(irm)).resolves.toBe(0.8);
    expect(safeContractRead).toHaveBeenCalledTimes(1);
  });

  it('falls back to 90% when the IRM has no kink() and retries the next read', async () => {
    const irm = '0x2222222222222222222222222222222222222222' as Address;
    safeContractRead.mockResolvedValue(null);

    await expect(getIRMTargetUtilizationWithFallback(irm)).resolves.toBe(0.9);
    await expect(getIRMTargetUtilizationWithFallback(irm)).resolves.toBe(0.9);
    expect(safeContractRead).toHaveBeenCalledTimes(2);
  });
});
