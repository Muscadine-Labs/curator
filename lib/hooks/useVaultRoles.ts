'use client';

import { useQuery } from '@tanstack/react-query';
import { Address } from 'viem';
import { BASE_CHAIN_ID } from '@/lib/constants';
import { readVaultRoles, readVaultAllocators, readPendingGuardian } from '@/lib/onchain/contracts';
import { morphoGraphQLClient } from '@/lib/morpho/graphql-client';
import { gql } from 'graphql-request';
import { logger } from '@/lib/utils/logger';

export interface VaultRolesData {
  owner: Address | null;
  curator: Address | null;
  guardian: Address | null;
  /** On-chain timelock contract address (fallback reads only). */
  timelock: Address | null;
  /** Morpho API: governance delay in seconds (V1). */
  timelockDurationSeconds: number | null;
  pendingGuardian: Address | null;
  allocators: Address[];
}

function parseTimelockDuration(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n) || n >= 1e15) return null;
  return n;
}

/**
 * Hook to fetch vault roles and allocators from GraphQL (with blockchain fallback)
 */
export function useVaultRoles(vaultAddress: Address | null | undefined, chainId: number = BASE_CHAIN_ID) {
  return useQuery<VaultRolesData>({
    queryKey: ['vault-roles', vaultAddress, chainId],
    queryFn: async () => {
      if (!vaultAddress) {
        throw new Error('Vault address is required');
      }

      // Try to fetch from GraphQL first
      try {
        const query = gql`
          query VaultRoles($address: String!, $chainId: Int!) {
            vault: vaultByAddress(address: $address, chainId: $chainId) {
              state {
                owner
                curator
                guardian
                timelock
              }
              allocators {
                address
              }
            }
          }
        `;

        const data = await morphoGraphQLClient.request<{
          vault: {
            state?: {
              owner?: string | null;
              curator?: string | null;
              guardian?: string | null;
              timelock?: string | null;
            } | null;
            allocators?: Array<{ address: string }> | null;
          } | null;
        }>(query, {
          address: vaultAddress,
          chainId,
        });

        if (data.vault) {
          const allocators: Address[] = (data.vault.allocators || [])
            .map((a) => a.address as Address)
            .filter((addr) => addr && addr !== '0x0000000000000000000000000000000000000000');

          return {
            owner: (data.vault.state?.owner as Address) || null,
            curator: (data.vault.state?.curator as Address) || null,
            guardian: (data.vault.state?.guardian as Address) || null,
            timelock: null,
            timelockDurationSeconds: parseTimelockDuration(data.vault.state?.timelock),
            pendingGuardian: null,
            allocators,
          };
        }
      } catch (error) {
        logger.warn('Failed to fetch roles from GraphQL, trying on-chain', { 
          vaultAddress, 
          chainId,
          error: error instanceof Error ? error : new Error(String(error))
        });
      }

      // Fallback to on-chain reads if GraphQL fails
      const roles = await readVaultRoles(vaultAddress);
      const pendingGuardian = await readPendingGuardian(vaultAddress);
      
      let allocators: Address[] = [];
      try {
        const onChainAllocators = await readVaultAllocators(vaultAddress);
        if (onChainAllocators) {
          allocators = onChainAllocators.filter(
            (addr) => addr && addr !== '0x0000000000000000000000000000000000000000'
          );
        }
      } catch (error) {
        logger.warn('Failed to fetch allocators on-chain', { 
          vaultAddress,
          error: error instanceof Error ? error : new Error(String(error))
        });
      }

      return {
        owner: roles.owner,
        curator: roles.curator,
        guardian: roles.guardian,
        timelock: roles.timelock,
        timelockDurationSeconds: null,
        pendingGuardian,
        allocators,
      };
    },
    enabled: !!vaultAddress,
  });
}

