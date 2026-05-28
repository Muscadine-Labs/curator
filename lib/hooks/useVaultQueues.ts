'use client';

import { useQuery } from '@tanstack/react-query';
import { morphoGraphQLClient } from '@/lib/morpho/graphql-client';
import { gql } from 'graphql-request';
import { BASE_CHAIN_ID } from '@/lib/constants';
import type { Address } from 'viem';

export interface QueuedMarket {
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
  queueIndex: number;
  supplyAssets?: number | null;
  supplyAssetsUsd?: number | null;
}

export interface VaultQueuesData {
  supplyQueue: QueuedMarket[];
  withdrawQueue: QueuedMarket[];
}

/**
 * Hook to fetch vault queues from GraphQL
 * Queues show the order in which markets receive deposits (supply) or are tapped for withdrawals
 */
export function useVaultQueues(vaultAddress: Address | string | null | undefined, chainId: number = BASE_CHAIN_ID) {
  return useQuery<VaultQueuesData>({
    queryKey: ['vault-queues', vaultAddress, chainId],
    queryFn: async () => {
      if (!vaultAddress) {
        throw new Error('Vault address is required');
      }

      const query = gql`
        query VaultQueues($address: String!, $chainId: Int!) {
          vault: vaultByAddress(address: $address, chainId: $chainId) {
            state {
              allocation {
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
            }
          }
        }
      `;

      type VaultQueuesResponse = {
        vault: {
          state?: {
            allocation?: Array<{
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
          } | null;
        } | null;
      };

      const data = await morphoGraphQLClient.request<VaultQueuesResponse>(query, {
        address: vaultAddress,
        chainId,
      });

      if (!data.vault?.state) {
        return { supplyQueue: [], withdrawQueue: [] };
      }

      // Create a map of market keys to allocation data (for supply/assets info)
      const allocationMap = new Map<string, { supplyAssets?: number | null; supplyAssetsUsd?: number | null }>();
      (data.vault.state.allocation || []).forEach((alloc) => {
        if (alloc && alloc.market?.marketId) {
          allocationMap.set(alloc.market.marketId, {
            supplyAssets: alloc.supplyAssets
              ? typeof alloc.supplyAssets === 'string'
                ? parseFloat(alloc.supplyAssets)
                : Number(alloc.supplyAssets)
              : null,
            supplyAssetsUsd: alloc.supplyAssetsUsd ?? null,
          });
        }
      });

      // Process supply queue
      const supplyQueue: QueuedMarket[] = (data.vault.state.allocationQueues || [])
        .filter((queue): queue is NonNullable<typeof queue> => queue !== null && queue.supplyQueueIndex !== null && queue.supplyQueueIndex !== undefined && !!queue.market?.marketId)
        .map((queue) => {
          const allocation = allocationMap.get(queue.market!.marketId!) || {};
          return {
            marketKey: queue.market!.marketId!,
            loanAsset: {
              symbol: queue.market!.loanAsset?.symbol || 'Unknown',
              address: queue.market!.loanAsset?.address || '',
              decimals: queue.market!.loanAsset?.decimals ?? 18,
            },
            collateralAsset: {
              symbol: queue.market!.collateralAsset?.symbol || 'Unknown',
              address: queue.market!.collateralAsset?.address || '',
            },
            queueIndex: queue.supplyQueueIndex!,
            supplyAssets: allocation.supplyAssets,
            supplyAssetsUsd: allocation.supplyAssetsUsd,
          };
        })
        .sort((a, b) => a.queueIndex - b.queueIndex);

      // Process withdraw queue
      const withdrawQueue: QueuedMarket[] = (data.vault.state.allocationQueues || [])
        .filter((queue): queue is NonNullable<typeof queue> => queue !== null && queue.withdrawQueueIndex !== null && queue.withdrawQueueIndex !== undefined && !!queue.market?.marketId)
        .map((queue) => {
          const allocation = allocationMap.get(queue.market!.marketId!) || {};
          return {
            marketKey: queue.market!.marketId!,
            loanAsset: {
              symbol: queue.market!.loanAsset?.symbol || 'Unknown',
              address: queue.market!.loanAsset?.address || '',
              decimals: queue.market!.loanAsset?.decimals ?? 18,
            },
            collateralAsset: {
              symbol: queue.market!.collateralAsset?.symbol || 'Unknown',
              address: queue.market!.collateralAsset?.address || '',
            },
            queueIndex: queue.withdrawQueueIndex!,
            supplyAssets: allocation.supplyAssets,
            supplyAssetsUsd: allocation.supplyAssetsUsd,
          };
        })
        .sort((a, b) => a.queueIndex - b.queueIndex);

      return { supplyQueue, withdrawQueue };
    },
    enabled: !!vaultAddress,
  });
}

