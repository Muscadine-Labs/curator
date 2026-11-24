import { publicErrorMessage } from '@/lib/utils/error-handler';
import { getAddress, type Address } from 'viem';
import { fetchSafeDelegates } from '@/lib/safe/transaction-service';
import type { SafeProposer, SafeProposersInfo } from '@/lib/safe/types';

export async function fetchSafeProposers(safeAddress: Address): Promise<SafeProposersInfo> {
  const apiKey = process.env.NEXT_PUBLIC_SAFE_API_KEY?.trim();
  if (!apiKey) {
    return { proposers: [], proposersConfigured: false };
  }

  try {
    // Delegates moved to the Safe Queue Service (Base chainId filter).
    const delegates = await fetchSafeDelegates(safeAddress);

    const proposers: SafeProposer[] = delegates.map((entry) => ({
      address: getAddress(entry.delegate),
      delegator: getAddress(entry.delegator),
      label: entry.label?.trim() ?? '',
    }));

    return { proposers, proposersConfigured: true };
  } catch (error) {
    return {
      proposers: [],
      proposersConfigured: true,
      proposersError: publicErrorMessage(error, 'Failed to load proposers'),
    };
  }
}
