import { Address } from 'viem';
import { safeContractRead } from '@/lib/onchain/client';

/**
 * Morpho AdaptiveCurveIRM, same CREATE2 address on Base.
 * It does not expose `kink()`. Target utilization is the library constant
 * `TARGET_UTILIZATION = 0.9 ether` (90%).
 */
const ADAPTIVE_CURVE_IRM = '0x46415998764c29ab2a25cbea6254146d50d22687';
const ADAPTIVE_CURVE_TARGET_UTILIZATION = 0.9;

// Some IRMs expose kink() as a WAD (1e18 = 100%). AdaptiveCurveIRM does not.
const IRM_ABI = [
  {
    name: 'kink',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

const kinkCache = new Map<string, number | null>();

/**
 * Get target utilization (kink) from an IRM contract.
 * Returns null if the contract doesn't have a kink() function or if address is invalid.
 */
async function getIRMTargetUtilization(irmAddress: Address | null): Promise<number | null> {
  if (!irmAddress || irmAddress.toLowerCase() === '0x0000000000000000000000000000000000000000') {
    return null;
  }

  const key = irmAddress.toLowerCase();
  if (key === ADAPTIVE_CURVE_IRM) return ADAPTIVE_CURVE_TARGET_UTILIZATION;

  const cached = kinkCache.get(key);
  if (cached !== undefined) return cached;

  const kinkRaw = await safeContractRead<bigint>(irmAddress, IRM_ABI, 'kink', [], {
    probe: true,
  });
  // Null is a revert or an RPC miss. Only a real kink ratio is cached, so a
  // timeout does not stick as the 90% fallback for the rest of the process.
  if (kinkRaw === null) return null;
  const kinkRatio = Number(kinkRaw) / 1e18;
  const result = kinkRatio >= 0 && kinkRatio <= 1 ? kinkRatio : null;
  if (result !== null) kinkCache.set(key, result);
  return result;
}

/**
 * Get target utilization with fallback to default (90% = 0.9)
 * 
 * @param irmAddress - The address of the IRM contract
 * @param defaultTargetUtilization - Default target utilization if IRM doesn't provide one (default: 0.9 = 90%)
 * @returns Target utilization as a ratio (0-1)
 */
export async function getIRMTargetUtilizationWithFallback(
  irmAddress: Address | null,
  defaultTargetUtilization: number = 0.9
): Promise<number> {
  const targetUtil = await getIRMTargetUtilization(irmAddress);
  return targetUtil ?? defaultTargetUtilization;
}

