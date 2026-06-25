import { getAddress, type Address } from 'viem';
import { BASE_CHAIN_ID } from '@/lib/constants';
import type { SafeProposer, SafeProposersInfo } from '@/lib/safe/types';

export async function fetchSafeProposers(safeAddress: Address): Promise<SafeProposersInfo> {
  const apiKey = process.env.NEXT_PUBLIC_SAFE_API_KEY?.trim();
  if (!apiKey) {
    return { proposers: [], proposersConfigured: false };
  }

  try {
    const { default: SafeApiKit } = await import('@safe-global/api-kit');
    const apiKit = new SafeApiKit({
      chainId: BigInt(BASE_CHAIN_ID),
      apiKey,
    });

    const response = await apiKit.getSafeDelegates({
      safeAddress: getAddress(safeAddress),
    });

    const proposers: SafeProposer[] = (response.results ?? []).map((entry) => ({
      address: getAddress(entry.delegate),
      delegator: getAddress(entry.delegator),
      label: entry.label?.trim() ?? '',
    }));

    return { proposers, proposersConfigured: true };
  } catch (error) {
    return {
      proposers: [],
      proposersConfigured: true,
      proposersError: error instanceof Error ? error.message : 'Failed to load proposers',
    };
  }
}
