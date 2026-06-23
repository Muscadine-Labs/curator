import { NextRequest, NextResponse } from 'next/server';
import { gql } from 'graphql-request';
import { getAddress, isAddress } from 'viem';
import { morphoGraphQLClient } from '@/lib/morpho/graphql-client';
import { getVaultByAddress } from '@/lib/config/vaults';
import { handleApiError, AppError } from '@/lib/utils/error-handler';
import { createRateLimitMiddleware, RATE_LIMIT_REQUESTS_PER_MINUTE, MINUTE_MS } from '@/lib/utils/rate-limit';
import { BASE_CHAIN_ID, VAULT_V2_GRAPHQL_ADAPTER_LIMIT, VAULT_V2_GRAPHQL_CAPS_LIMIT } from '@/lib/constants';
import { mapCap, type GraphCap } from '@/lib/morpho/vault-v2-governance-map';
import { enrichCollateralCapSymbols, enrichMarketCapParams } from '@/lib/morpho/fetch-markets-by-id';
import { mergeApiCacheHeaders } from '@/lib/api/response-cache';

type GraphAdapter = {
  __typename?: 'MetaMorphoAdapter' | 'MorphoMarketV1Adapter' | string | null;
  address?: string | null;
  type?: string | null;
  assets?: number | string | null;
  assetsUsd?: number | null;
  forceDeallocatePenalty?: string | number | null;
  factory?: { address?: string | null } | null;
  metaMorpho?: { address?: string | null; name?: string | null; symbol?: string | null } | null;
};

type GraphLiquidityData =
  | {
      __typename?: 'MarketV1LiquidityData';
      market?: {
        marketId?: string | null;
        loanAsset?: { address?: string | null; symbol?: string | null } | null;
        collateralAsset?: { address?: string | null; symbol?: string | null } | null;
        oracleAddress?: string | null;
        irmAddress?: string | null;
        lltv?: string | number | null;
      } | null;
    }
  | {
      __typename?: 'MetaMorphoLiquidityData';
      metaMorpho?: { address?: string | null; name?: string | null; symbol?: string | null } | null;
    }
  | null;

type GraphVaultGovernanceResponse = {
    vault?: {
    address?: string | null;
    idleAssets?: string | number | null;
    idleAssetsUsd?: number | null;
    liquidity?: string | number | null;
    liquidityUsd?: number | null;
    liquidityData?: GraphLiquidityData;
    maxRate?: string | number | null;
    performanceFeeRecipient?: string | null;
    managementFeeRecipient?: string | null;
    owner?: { address?: string | null } | null;
    curator?: { address?: string | null } | null;
    allocators?: Array<{ allocator?: { address?: string | null } | null } | null> | null;
    sentinels?: Array<{ sentinel?: { address?: string | null } | null } | null> | null;
    liquidityAdapter?: GraphAdapter | null;
    adapters?: { items?: Array<GraphAdapter | null> | null } | null;
    caps?: { items?: Array<GraphCap | null> | null } | null;
    timelocks?: Array<{ selector?: string | null; functionName?: string | null; duration?: number | string | null; abdicatedAt?: string | number | null } | null> | null;
  } | null;
};

export type LiquidityDataInfo = {
  kind: 'market' | 'metaMorpho';
  marketKey?: string | null;
  marketParams?: CapInfo['marketParams'];
  metaMorphoAddress?: string | null;
  metaMorphoName?: string | null;
  metaMorphoSymbol?: string | null;
};

export type VaultV2GovernanceResponse = {
  vaultAddress: string;
  idleAssets: string | null;
  idleAssetsUsd: number | null;
  liquidity: string | null;
  liquidityUsd: number | null;
  liquidityData: LiquidityDataInfo | null;
  owner: string | null;
  curator: string | null;
  allocators: string[];
  sentinels: string[];
  performanceFeeRecipient: string | null;
  managementFeeRecipient: string | null;
  maxRate: string | null;
  liquidityAdapter: AdapterInfo | null;
  adapters: AdapterInfo[];
  caps: CapInfo[];
  timelocks: TimelockInfo[];
};

export type AdapterInfo = {
  address: string;
  type: string;
  assets: number | null;
  assetsUsd: number | null;
  factoryAddress: string | null;
  forceDeallocatePenalty: string | null;
  metaMorpho?: { address: string | null; name: string | null; symbol: string | null } | null;
};

export type CapInfo = {
  type: string;
  absoluteCap: string;
  relativeCap: string;
  allocation: string;
  adapterAddress?: string | null;
  marketKey?: string | null;
  collateralAddress?: string | null;
  collateralSymbol?: string | null;
  /** Full Blue market params from governance (for caps with no current allocation). */
  marketParams?: {
    loanAsset?: { address: string; symbol?: string | null; decimals?: number | null } | null;
    collateralAsset?: { address: string; symbol?: string | null; decimals?: number | null } | null;
    oracleAddress?: string | null;
    irmAddress?: string | null;
    lltv?: string | null;
    state?: {
      supplyApy?: number | null;
      borrowApy?: number | null;
      utilization?: number | null;
      liquidityAssets?: string | number | null;
      liquidityAssetsUsd?: number | null;
    } | null;
  } | null;
};

export type TimelockInfo = {
  selector: string;
  functionName: string;
  durationSeconds: number;
  /** Unix timestamp when the function was abdicated, if permanently disabled. */
  abdicatedAt: number | null;
};

const ADAPTER_LIMIT = VAULT_V2_GRAPHQL_ADAPTER_LIMIT;
const CAPS_LIMIT = VAULT_V2_GRAPHQL_CAPS_LIMIT;

const VAULT_V2_GOVERNANCE_QUERY = gql`
  query VaultV2Governance($address: String!, $chainId: Int!, $adapterLimit: Int!, $capLimit: Int!) {
    vault: vaultV2ByAddress(address: $address, chainId: $chainId) {
      address
      idleAssets
      idleAssetsUsd
      liquidity
      liquidityUsd
      maxRate
      performanceFeeRecipient
      managementFeeRecipient
      owner { address }
      curator { address }
      allocators { allocator { address } }
      sentinels { sentinel { address } }
      liquidityAdapter {
        __typename
        address
        ... on MetaMorphoAdapter {
          type
          assets
          assetsUsd
          forceDeallocatePenalty
          factory { address }
          metaMorpho { address name symbol }
        }
        ... on MorphoMarketV1Adapter {
          type
          assets
          assetsUsd
          forceDeallocatePenalty
        }
      }
      liquidityData {
        __typename
        ... on MarketV1LiquidityData {
          market {
            marketId
            loanAsset { address symbol }
            collateralAsset { address symbol }
            oracleAddress
            irmAddress
            lltv
          }
        }
        ... on MetaMorphoLiquidityData {
          metaMorpho { address name symbol }
        }
      }
      adapters(first: $adapterLimit) {
        items {
          __typename
          address
          ... on MetaMorphoAdapter {
            type
            assets
            assetsUsd
            forceDeallocatePenalty
            factory { address }
            metaMorpho { address name symbol }
          }
          ... on MorphoMarketV1Adapter {
            type
            assets
            assetsUsd
            forceDeallocatePenalty
          }
        }
      }
      caps(first: $capLimit) {
        items {
          type
          absoluteCap
          relativeCap
          allocation
          data {
            __typename
            ... on AdapterCapData {
              adapterAddress
            }
            ... on MarketV1CapData {
              adapterAddress
              market {
                marketId
                loanAsset { address symbol decimals }
                collateralAsset { address symbol decimals }
                oracleAddress
                irmAddress
                lltv
                state {
                  supplyApy
                  borrowApy
                  utilization
                  liquidityAssets
                  liquidityAssetsUsd
                }
              }
            }
            ... on CollateralCapData {
              collateralAddress
            }
          }
        }
      }
      timelocks {
        selector
        functionName
        duration
        abdicatedAt
      }
    }
  }
`;

function mapAdapter(graph: GraphAdapter | null | undefined): AdapterInfo | null {
  if (!graph?.address) return null;

  return {
    address: graph.address,
    type: graph.type ?? 'Unknown',
    assets:
      graph.assets === null || graph.assets === undefined
        ? null
        : typeof graph.assets === 'string'
        ? Number(graph.assets)
        : graph.assets,
    assetsUsd: graph.assetsUsd ?? null,
    factoryAddress: graph.factory?.address ?? null,
    forceDeallocatePenalty:
      graph.forceDeallocatePenalty != null && graph.forceDeallocatePenalty !== ''
        ? String(graph.forceDeallocatePenalty)
        : null,
    metaMorpho: graph.__typename === 'MetaMorphoAdapter'
      ? {
          address: graph.metaMorpho?.address ?? null,
          name: graph.metaMorpho?.name ?? null,
          symbol: graph.metaMorpho?.symbol ?? null,
        }
      : null,
  };
}

function mapLiquidityData(data: GraphLiquidityData): LiquidityDataInfo | null {
  if (!data?.__typename) return null;

  if (data.__typename === 'MetaMorphoLiquidityData') {
    return {
      kind: 'metaMorpho',
      metaMorphoAddress: data.metaMorpho?.address ?? null,
      metaMorphoName: data.metaMorpho?.name ?? null,
      metaMorphoSymbol: data.metaMorpho?.symbol ?? null,
    };
  }

  if (data.__typename === 'MarketV1LiquidityData' && data.market) {
    return {
      kind: 'market',
      marketKey: data.market.marketId ?? null,
      marketParams: {
        loanAsset: data.market.loanAsset?.address
          ? { address: data.market.loanAsset.address, symbol: data.market.loanAsset.symbol }
          : null,
        collateralAsset: data.market.collateralAsset?.address
          ? {
              address: data.market.collateralAsset.address,
              symbol: data.market.collateralAsset.symbol,
            }
          : null,
        oracleAddress: data.market.oracleAddress ?? null,
        irmAddress: data.market.irmAddress ?? null,
        lltv:
          data.market.lltv != null && data.market.lltv !== ''
            ? String(data.market.lltv)
            : null,
      },
    };
  }

  return null;
}

function mapTimelock(entry: {
  selector?: string | null;
  functionName?: string | null;
  duration?: number | string | null;
  abdicatedAt?: string | number | null;
} | null | undefined): TimelockInfo | null {
  if (!entry?.selector || !entry.functionName) return null;

  const abdicatedRaw = entry.abdicatedAt;
  const abdicatedAt =
    abdicatedRaw == null || abdicatedRaw === ''
      ? null
      : typeof abdicatedRaw === 'string'
        ? Number(abdicatedRaw)
        : abdicatedRaw;

  return {
    selector: entry.selector,
    functionName: entry.functionName,
    durationSeconds:
      entry.duration === null || entry.duration === undefined
        ? 0
        : typeof entry.duration === 'string'
        ? Number(entry.duration)
        : entry.duration,
    abdicatedAt: abdicatedAt != null && abdicatedAt > 0 ? abdicatedAt : null,
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitMiddleware = createRateLimitMiddleware(
    RATE_LIMIT_REQUESTS_PER_MINUTE,
    MINUTE_MS
  );
  const rateLimitResult = rateLimitMiddleware(request);

  if (!rateLimitResult.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please try again later.' },
      { status: 429, headers: rateLimitResult.headers }
    );
  }

  try {
    const { id } = await params;

    let address: string;
    if (isAddress(id)) {
      address = getAddress(id);
    } else {
      const cfg = getVaultByAddress(id);
      if (!cfg) {
        throw new AppError('Vault not found', 404, 'VAULT_NOT_FOUND');
      }
      address = getAddress(cfg.address);
    }

    const cfg = getVaultByAddress(address);
    const chainId = cfg?.chainId ?? BASE_CHAIN_ID;

    const data = await morphoGraphQLClient.request<GraphVaultGovernanceResponse>(
      VAULT_V2_GOVERNANCE_QUERY,
      {
        address,
        chainId,
        adapterLimit: ADAPTER_LIMIT,
        capLimit: CAPS_LIMIT,
      }
    );

    if (!data.vault) {
      throw new AppError('Vault not found in Morpho API', 404, 'VAULT_NOT_FOUND');
    }

    const adapters =
      data.vault.adapters?.items
        ?.map(mapAdapter)
        .filter((a): a is AdapterInfo => a !== null) ?? [];

    const liquidityAdapter = mapAdapter(data.vault.liquidityAdapter);

    const capsRaw =
      data.vault.caps?.items
        ?.map(mapCap)
        .filter((c): c is CapInfo => c !== null) ?? [];

    const caps = await enrichCollateralCapSymbols(
      await enrichMarketCapParams(capsRaw, chainId),
      chainId
    );

    const timelocks =
      data.vault.timelocks
        ?.map(mapTimelock)
        .filter((t): t is TimelockInfo => t !== null) ?? [];

    const response: VaultV2GovernanceResponse = {
      vaultAddress: address,
      idleAssets:
        data.vault.idleAssets != null && data.vault.idleAssets !== undefined
          ? String(data.vault.idleAssets)
          : null,
      idleAssetsUsd: data.vault.idleAssetsUsd ?? null,
      liquidity:
        data.vault.liquidity != null && data.vault.liquidity !== undefined
          ? String(data.vault.liquidity)
          : null,
      liquidityUsd: data.vault.liquidityUsd ?? null,
      liquidityData: mapLiquidityData(data.vault.liquidityData ?? null),
      owner: data.vault.owner?.address ?? null,
      curator: data.vault.curator?.address ?? null,
      allocators:
        data.vault.allocators
          ?.map((a) => a?.allocator?.address)
          .filter((addr): addr is string => Boolean(addr)) ?? [],
      sentinels:
        data.vault.sentinels
          ?.map((s) => s?.sentinel?.address)
          .filter((addr): addr is string => Boolean(addr)) ?? [],
      performanceFeeRecipient: data.vault.performanceFeeRecipient ?? null,
      managementFeeRecipient: data.vault.managementFeeRecipient ?? null,
      maxRate:
        data.vault.maxRate != null && data.vault.maxRate !== undefined
          ? String(data.vault.maxRate)
          : null,
      liquidityAdapter,
      adapters,
      caps,
      timelocks,
    };

    const responseHeaders = mergeApiCacheHeaders(rateLimitResult.headers);

    return NextResponse.json(response, { headers: responseHeaders });
  } catch (error) {
    const { error: apiError, statusCode } = handleApiError(error, 'Failed to fetch v2 governance data');
    return NextResponse.json(apiError, { status: statusCode });
  }
}

