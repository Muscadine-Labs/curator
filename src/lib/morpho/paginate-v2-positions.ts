import { gql } from 'graphql-request';
import { getAddress } from 'viem';
import { GRAPHQL_FIRST_LIMIT } from '@/lib/constants';
import { morphoGraphQLClient } from '@/lib/morpho/graphql-client';

const PAGE = GRAPHQL_FIRST_LIMIT;
const MAX_PAGES = 20;

const POSITIONS_PAGE_QUERY = gql`
  query V2VaultPositionsPage(
    $address: String!
    $chainId: Int!
    $first: Int!
    $skip: Int!
  ) {
    vaultV2ByAddress(address: $address, chainId: $chainId) {
      positions(first: $first, skip: $skip) {
        items {
          user {
            address
          }
          assets
          assetsUsd
          shares
        }
      }
    }
  }
`;

export type V2PositionItem = {
  user?: { address?: string | null } | null;
  assets?: string | null;
  assetsUsd?: number | null;
  shares?: string | null;
};

export async function fetchAllV2Positions(
  address: string,
  chainId: number,
  startSkip = 0
): Promise<V2PositionItem[]> {
  const addr = getAddress(address);
  const out: V2PositionItem[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const skip = startSkip + page * PAGE;
    const data = await morphoGraphQLClient.request<{
      vaultV2ByAddress?: {
        positions?: { items?: Array<V2PositionItem | null> | null } | null;
      } | null;
    }>(POSITIONS_PAGE_QUERY, {
      address: addr,
      chainId,
      first: PAGE,
      skip: skip,
    });
    const items = (data.vaultV2ByAddress?.positions?.items ?? []).filter(
      (x): x is V2PositionItem => x != null
    );
    out.push(...items);
    if (items.length < PAGE) break;
  }
  return out;
}
