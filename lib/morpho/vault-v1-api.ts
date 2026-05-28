import { gql } from 'graphql-request';
import { formatNumber } from '@/lib/format/number';

export const VAULT_V1_PENDING_QUERY = gql`
  query VaultV1Pending($address: String!, $chainId: Int!, $first: Int!) {
    vault: vaultByAddress(address: $address, chainId: $chainId) {
      address
      state {
        pendingConfigs(first: $first) {
          items {
            functionName
            txHash
            validAt
            decodedData {
              __typename
              ... on VaultSetCapPendingData {
                supplyCap
                market {
                  marketId
                  loanAsset {
                    address
                  }
                  collateralAsset {
                    address
                  }
                  oracleAddress
                  irmAddress
                  lltv
                }
              }
              ... on VaultSetGuardianPendingData {
                guardian {
                  address
                }
              }
              ... on VaultSetTimelockPendingData {
                timelock
              }
              ... on VaultRemoveMarketPendingData {
                caller {
                  address
                }
                market {
                  marketId
                  loanAsset {
                    symbol
                  }
                  collateralAsset {
                    symbol
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

export type VaultV1MarketParams = {
  loanToken: string;
  collateralToken: string;
  oracle: string;
  irm: string;
  lltv: string;
};

export type VaultV1PendingDecoded =
  | { type: 'SetCap'; supplyCap: string; marketKey: string | null; marketParams: VaultV1MarketParams | null }
  | { type: 'SetGuardian'; guardian: string }
  | { type: 'SetTimelock'; timelock: string }
  | { type: 'RemoveMarket'; caller: string; marketKey: string | null; marketLabel: string | null }
  | { type: 'Unknown' };

export function mapV1PendingDecoded(
  decoded: { __typename?: string | null } & Record<string, unknown> | null | undefined
): VaultV1PendingDecoded {
  if (!decoded?.__typename) return { type: 'Unknown' };

  switch (decoded.__typename) {
    case 'VaultSetCapPendingData': {
      const market = decoded.market as {
        marketId?: string | null;
        loanAsset?: { address?: string | null } | null;
        collateralAsset?: { address?: string | null } | null;
        oracleAddress?: string | null;
        irmAddress?: string | null;
        lltv?: string | number | null;
      } | null;

      const hasParams =
        market?.loanAsset?.address &&
        market?.collateralAsset?.address &&
        market?.oracleAddress &&
        market?.irmAddress &&
        market?.lltv != null;

      return {
        type: 'SetCap',
        supplyCap: String(decoded.supplyCap ?? '0'),
        marketKey: market?.marketId ?? null,
        marketParams: hasParams
          ? {
              loanToken: market!.loanAsset!.address!,
              collateralToken: market!.collateralAsset!.address!,
              oracle: market!.oracleAddress!,
              irm: market!.irmAddress!,
              lltv: String(market!.lltv),
            }
          : null,
      };
    }
    case 'VaultSetGuardianPendingData':
      return {
        type: 'SetGuardian',
        guardian: String((decoded.guardian as { address?: string })?.address ?? ''),
      };
    case 'VaultSetTimelockPendingData':
      return {
        type: 'SetTimelock',
        timelock: String(decoded.timelock ?? '0'),
      };
    case 'VaultRemoveMarketPendingData': {
      const market = decoded.market as {
        marketId?: string | null;
        loanAsset?: { symbol?: string | null } | null;
        collateralAsset?: { symbol?: string | null } | null;
      } | null;
      const loan = market?.loanAsset?.symbol;
      const coll = market?.collateralAsset?.symbol;
      const marketLabel =
        loan && coll ? `${loan}/${coll}` : market?.marketId ? market.marketId.slice(0, 10) + '…' : null;

      return {
        type: 'RemoveMarket',
        caller: String((decoded.caller as { address?: string })?.address ?? ''),
        marketKey: market?.marketId ?? null,
        marketLabel,
      };
    }
    default:
      return { type: 'Unknown' };
  }
}

export function describeV1PendingDecoded(decoded: VaultV1PendingDecoded): string {
  switch (decoded.type) {
    case 'SetCap': {
      const cap = formatNumber(BigInt(decoded.supplyCap));
      const key = decoded.marketKey ? `${decoded.marketKey.slice(0, 10)}…` : 'market';
      return `Supply cap → ${cap} (${key})`;
    }
    case 'SetGuardian':
      return `Guardian → ${decoded.guardian}`;
    case 'SetTimelock':
      return `Timelock → ${decoded.timelock}s`;
    case 'RemoveMarket':
      return `Remove market ${decoded.marketLabel ?? decoded.marketKey ?? ''}`;
    default:
      return 'Pending change';
  }
}
