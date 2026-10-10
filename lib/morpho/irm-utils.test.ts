import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Address } from 'viem';

const readContractOutcome = vi.fn();

vi.mock('@/lib/onchain/client', () => ({
  readContractOutcome: (...args: unknown[]) => readContractOutcome(...args),
}));

import { getIRMTargetUtilizationWithFallback } from './irm-utils';

const ADAPTIVE_CURVE_IRM = '0x46415998764C29aB2a25CbeA6254146D50D22687' as Address;

describe('getIRMTargetUtilizationWithFallback', () => {
  beforeEach(() => {
    readContractOutcome.mockReset();
  });

  it('uses the Adaptive Curve IRM 90% target without an RPC read', async () => {
    await expect(getIRMTargetUtilizationWithFallback(ADAPTIVE_CURVE_IRM)).resolves.toBe(0.9);
    expect(readContractOutcome).not.toHaveBeenCalled();
  });

  it('reads kink() once for another IRM and reuses the result', async () => {
    const irm = '0x1111111111111111111111111111111111111111' as Address;
    readContractOutcome.mockResolvedValue({ status: 'ok', value: 800000000000000000n });

    await expect(getIRMTargetUtilizationWithFallback(irm)).resolves.toBe(0.8);
    await expect(getIRMTargetUtilizationWithFallback(irm)).resolves.toBe(0.8);
    expect(readContractOutcome).toHaveBeenCalledTimes(1);
  });

  it('falls back to 90% when the IRM has no kink() and does not probe it again', async () => {
    const irm = '0x2222222222222222222222222222222222222222' as Address;
    readContractOutcome.mockResolvedValue({ status: 'miss' });

    await expect(getIRMTargetUtilizationWithFallback(irm)).resolves.toBe(0.9);
    await expect(getIRMTargetUtilizationWithFallback(irm)).resolves.toBe(0.9);
    expect(readContractOutcome).toHaveBeenCalledTimes(1);
  });

  it('retries after an RPC failure instead of caching the fallback', async () => {
    const irm = '0x3333333333333333333333333333333333333333' as Address;
    readContractOutcome
      .mockResolvedValueOnce({ status: 'error' })
      .mockResolvedValueOnce({ status: 'ok', value: 850000000000000000n });

    await expect(getIRMTargetUtilizationWithFallback(irm)).resolves.toBe(0.9);
    await expect(getIRMTargetUtilizationWithFallback(irm)).resolves.toBe(0.85);
    expect(readContractOutcome).toHaveBeenCalledTimes(2);
  });
});
