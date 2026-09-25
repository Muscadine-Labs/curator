import { getAddress, keccak256, type Hex } from 'viem';
import type { CapInfo } from '@/app/api/vaults/[id]/governance/route';
import { BASE_CHAIN_ID } from '@/lib/constants';
import { getVaultV2PublicAllocatorAddress } from '@/lib/constants/bots';
import { isMarketCap } from '@/lib/morpho/cap-utils';
import { resolveCapIdData } from '@/lib/morpho/v2-id-data';
import { publicClient } from '@/lib/onchain/client';
import { vaultV2BluePublicAllocatorAbi } from '@/lib/onchain/abis';
import { logger } from '@/lib/utils/logger';

export type VaultV2PublicAllocatorMarket = {
  marketKey: string;
  adapterAddress: string;
  /** Null when the on-chain `absoluteCap` read failed — do not treat as zero. */
  absoluteCap: string | null;
  canPullFromMarket: boolean | null;
};

export type VaultV2PublicAllocatorState = {
  address: string;
  canPullFromIdle: boolean | null;
  penalty: string | null;
  markets: VaultV2PublicAllocatorMarket[];
};

function vaultHasPublicAllocator(
  allocators: string[],
  chainId: number
): boolean {
  const pa = getVaultV2PublicAllocatorAddress(chainId);
  if (!pa) return false;
  const needle = pa.toLowerCase();
  return allocators.some((a) => a.toLowerCase() === needle);
}

function adapterMarketCapId(cap: CapInfo): Hex | null {
  if (!isMarketCap(cap)) return null;
  // resolveCapIdData only encodes params that hash back to the cap's market.
  const idData = resolveCapIdData(cap, null);
  return idData ? keccak256(idData) : null;
}

/**
 * On-chain Vault V2 Blue Public Allocator settings.
 * Shown on Caps only when the PA contract is an allocator of the vault.
 * @see https://docs.morpho.org/learn/concepts/public-allocator/
 */
export async function fetchVaultV2PublicAllocatorState(
  vaultAddress: string,
  chainId: number,
  allocators: string[],
  caps: CapInfo[]
): Promise<VaultV2PublicAllocatorState | null> {
  const pa = getVaultV2PublicAllocatorAddress(chainId);
  if (!pa || !vaultHasPublicAllocator(allocators, chainId)) return null;

  if (chainId !== BASE_CHAIN_ID) {
    return {
      address: pa,
      canPullFromIdle: null,
      penalty: null,
      markets: [],
    };
  }

  const vault = getAddress(vaultAddress);
  const allocator = getAddress(pa);

  const marketCaps: Array<{ cap: CapInfo; id: Hex }> = [];
  for (const cap of caps) {
    const id = adapterMarketCapId(cap);
    if (id) marketCaps.push({ cap, id });
  }

  try {
    const vaultData = await publicClient.readContract({
      address: allocator,
      abi: vaultV2BluePublicAllocatorAbi,
      functionName: 'vaultData',
      args: [vault],
    });

    const marketContracts = marketCaps.flatMap(({ id }) => [
      {
        address: allocator,
        abi: vaultV2BluePublicAllocatorAbi,
        functionName: 'absoluteCap' as const,
        args: [vault, id] as const,
      },
      {
        address: allocator,
        abi: vaultV2BluePublicAllocatorAbi,
        functionName: 'canPullFromMarket' as const,
        args: [vault, id] as const,
      },
    ]);

    const marketResults =
      marketContracts.length > 0
        ? await publicClient.multicall({ contracts: marketContracts, allowFailure: true })
        : [];

    const markets: VaultV2PublicAllocatorMarket[] = [];
    for (let i = 0; i < marketCaps.length; i++) {
      const cap = marketCaps[i]!.cap;
      const abs = marketResults[i * 2];
      const pull = marketResults[i * 2 + 1];
      markets.push({
        marketKey: cap.marketKey ?? '',
        adapterAddress: cap.adapterAddress!,
        absoluteCap: abs?.status === 'success' ? abs.result.toString() : null,
        canPullFromMarket: pull?.status === 'success' ? Boolean(pull.result) : null,
      });
    }

    return {
      address: pa,
      canPullFromIdle: vaultData[0],
      penalty: vaultData[1].toString(),
      markets,
    };
  } catch (error) {
    logger.warn('Failed to read Vault V2 Public Allocator state', {
      vaultAddress,
      chainId,
      error: error instanceof Error ? error : new Error(String(error)),
    });
    return {
      address: pa,
      canPullFromIdle: null,
      penalty: null,
      markets: [],
    };
  }
}
