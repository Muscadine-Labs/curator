import { Address } from 'viem';
import { safeContractRead } from '@/lib/onchain/client';

// IRM ABI - most Morpho IRMs have a kink() function that returns target utilization
const IRM_ABI = [
  {
    name: 'kink',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

/**
 * Get target utilization (kink) from an IRM contract
 * Returns null if the contract doesn't have a kink() function or if address is invalid
 * 
 * @param irmAddress - The address of the IRM contract
 * @returns Target utilization as a ratio (0-1), or null if not available
 */
async function getIRMTargetUtilization(irmAddress: Address | null): Promise<number | null> {
  if (!irmAddress || irmAddress.toLowerCase() === '0x0000000000000000000000000000000000000000') {
    return null;
  }

  try {
    // Try to read kink from IRM contract
    // kink is typically stored as a uint256 where 1e18 = 100% (1.0)
    const kinkRaw = await safeContractRead<bigint>(irmAddress, IRM_ABI, 'kink', []);
    
    if (kinkRaw === null) {
      return null;
    }

    // Convert from wei format (1e18 = 100%) to ratio (0-1)
    const kinkRatio = Number(kinkRaw) / 1e18;
    
    // Validate the ratio is reasonable (between 0 and 1)
    if (kinkRatio < 0 || kinkRatio > 1) {
      return null;
    }

    return kinkRatio;
  } catch {
    // Contract doesn't have kink() function or other error
    return null;
  }
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

