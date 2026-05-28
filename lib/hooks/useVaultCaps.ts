'use client';

import { useQuery } from '@tanstack/react-query';
import { morphoGraphQLClient } from '@/lib/morpho/graphql-client';
import { gql } from 'graphql-request';
import { BASE_CHAIN_ID } from '@/lib/constants';
import type { Address } from 'viem';

export interface MarketCap {
  marketKey: string;
  loanAsset: {
    symbol: string;
    address: string;
    decimals: number;
  };
  collateralAsset: {
    symbol: string;
    address: string;
  };
  supplyCap: number | null;
  supplyAssets: number | null;
  supplyAssetsUsd: number | null;
  supplyQueueIndex: number | null;
  withdrawQueueIndex: number | null;
}

export interface VaultCapsData {
  markets: MarketCap[];
}

/**
 * Hook to fetch vault market caps from GraphQL
 */
export function useVaultCaps(vaultAddress: Address | string | null | undefined, chainId: number = BASE_CHAIN_ID) {
  return useQuery<VaultCapsData>({
    queryKey: ['vault-caps', vaultAddress, chainId],
    queryFn: async () => {
      if (!vaultAddress) {
        throw new Error('Vault address is required');
      }

      const query = gql`
        query VaultCaps($address: String!, $chainId: Int!) {
          vault: vaultByAddress(address: $address, chainId: $chainId) {
            state {
              allocation {
                supplyCap
                supplyAssets
                supplyAssetsUsd
                market {
                  marketId
                  loanAsset {
                    symbol
                    address
                    decimals
                  }
                  collateralAsset {
                    symbol
                    address
                  }
                }
              }
              allocationQueues: allocation {
                supplyQueueIndex
                withdrawQueueIndex
                market {
                  marketId
                }
              }
            }
          }
        }
      `;

      type VaultCapsResponse = {
        vault: {
          state?: {
            allocation?: Array<{
              supplyCap?: string | number | null;
              supplyAssets?: string | number | null;
              supplyAssetsUsd?: number | null;
              market?: {
                marketId?: string | null;
                loanAsset?: {
                  symbol?: string | null;
                  address?: string | null;
                  decimals?: number | null;
                } | null;
                collateralAsset?: {
                  symbol?: string | null;
                  address?: string | null;
                } | null;
              } | null;
            } | null> | null;
            allocationQueues?: Array<{
              supplyQueueIndex?: number | null;
              withdrawQueueIndex?: number | null;
              market?: {
                marketId?: string | null;
              } | null;
            } | null> | null;
          } | null;
        } | null;
      };

      const data = await morphoGraphQLClient.request<VaultCapsResponse>(query, {
        address: vaultAddress,
        chainId,
      });

      if (!data.vault?.state) {
        return { markets: [] };
      }

      const allocation = data.vault.state.allocation || [];
      const queues = data.vault.state.allocationQueues || [];

      // Create a map of market keys to queue indices
      const queueMap = new Map<string, { supplyQueueIndex: number | null; withdrawQueueIndex: number | null }>();
      queues.forEach((queue) => {
        const queueMarketKey = queue?.market?.marketId;
        if (queue && queueMarketKey) {
          queueMap.set(queueMarketKey, {
            supplyQueueIndex: queue.supplyQueueIndex ?? null,
            withdrawQueueIndex: queue.withdrawQueueIndex ?? null,
          });
        }
      });

      // Filter out null allocations and those without valid markets
      const validAllocations = allocation.filter(
        (alloc): alloc is NonNullable<typeof alloc> => alloc !== null && !!alloc.market?.marketId
      );

      const markets: MarketCap[] = validAllocations.map((alloc) => {
        const marketKey = alloc.market!.marketId!;
          const queueInfo = queueMap.get(marketKey) || { supplyQueueIndex: null, withdrawQueueIndex: null };

          return {
            marketKey,
            loanAsset: {
              symbol: alloc.market!.loanAsset?.symbol || 'Unknown',
              address: alloc.market!.loanAsset?.address || '',
              decimals: alloc.market!.loanAsset?.decimals ?? 18,
            },
            collateralAsset: {
              symbol: alloc.market!.collateralAsset?.symbol || 'Unknown',
              address: alloc.market!.collateralAsset?.address || '',
            },
            supplyCap: alloc.supplyCap
              ? typeof alloc.supplyCap === 'string'
                ? parseFloat(alloc.supplyCap)
                : Number(alloc.supplyCap)
              : null,
            supplyAssets: alloc.supplyAssets
              ? typeof alloc.supplyAssets === 'string'
                ? parseFloat(alloc.supplyAssets)
                : Number(alloc.supplyAssets)
              : null,
            supplyAssetsUsd: alloc.supplyAssetsUsd ?? null,
            supplyQueueIndex: queueInfo.supplyQueueIndex,
            withdrawQueueIndex: queueInfo.withdrawQueueIndex,
          };
        });

      return { markets };
    },
    enabled: !!vaultAddress,
  });
}

