import { NextRequest, NextResponse } from 'next/server';
import { gql } from 'graphql-request';
import { getAddress, isAddress, keccak256, zeroAddress, type Address, type Hex } from 'viem';
import { morphoGraphQLClient } from '@/lib/morpho/graphql-client';
import { getVaultByAddress } from '@/lib/config/vaults';
import { handleApiError, AppError } from '@/lib/utils/error-handler';
import { createRateLimitMiddleware, RATE_LIMIT_REQUESTS_PER_MINUTE, MINUTE_MS } from '@/lib/utils/rate-limit';
import { BASE_CHAIN_ID, VAULT_V2_GRAPHQL_ADAPTER_LIMIT, VAULT_V2_GRAPHQL_CAPS_LIMIT } from '@/lib/constants';
import { mapCap, type GraphCap } from '@/lib/morpho/vault-v2-governance-map';
import { enrichCollateralCapSymbols, enrichMarketCapParams } from '@/lib/morpho/fetch-markets-by-id';
import { overlayV2OnChainCaps } from '@/lib/morpho/overlay-v2-onchain-caps';
import { resolveMarketOracleAddress } from '@/lib/morpho/market-oracle-address';
import {
  fetchVaultV2PublicAllocatorState,
  type VaultV2PublicAllocatorState,
} from '@/lib/morpho/v2-public-allocator';
import { mergeApiOnChainVaultHeaders } from '@/lib/api/response-cache';
import { logger } from '@/lib/utils/logger';
import { publicClient } from '@/lib/onchain/client';
import { vaultV2Abi } from '@/lib/onchain/abis';
import { isMarketCap } from '@/lib/morpho/cap-utils';
import { unauthorizedUnlessAdmin } from '@/lib/auth/require-admin';
import { isMorphoVaultV2Adapter, mergeUnderlyingVaultInfo } from '@/lib/morpho/vault-v2-adapter';

type GraphAdapter = {
  __typename?: 'MetaMorphoAdapter' | 'MorphoMarketV1Adapter' | 'MorphoVaultV2Adapter' | string | null;
  address?: string | null;
  type?: string | null;
  assets?: number | string | null;
  assetsUsd?: number | null;
  forceDeallocatePenalty?: string | number | null;
  factory?: { address?: string | null } | null;
  metaMorpho?: { address?: string | null; name?: string | null; symbol?: string | null } | null;
  innerVault?: {
    address?: string | null;
    name?: string | null;
    symbol?: string | null;
  } | null;
};

type GraphLiquidityData =
  | {
      __typename?: 'MarketV1LiquidityData';
      market?: {
        marketId?: string | null;
        loanAsset?: { address?: string | null; symbol?: string | null } | null;
        collateralAsset?: { address?: string | null; symbol?: string | null } | null;
        oracle?: { address?: string | null } | null;
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
  /** Present when the Vault V2 Blue Public Allocator is an allocator of this vault. */
  publicAllocator: VaultV2PublicAllocatorState | null;
};

export type AdapterInfo = {
  address: string;
  type: string;
  assets: number | null;
  assetsUsd: number | null;
  factoryAddress: string | null;
  forceDeallocatePenalty: string | null;
  metaMorpho?: { address: string | null; name: string | null; symbol: string | null } | null;
  underlying?: { address: string | null; name: string | null; symbol: string | null } | null;
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
      supplyAssetsUsd?: number | null;
      borrowAssetsUsd?: number | null;
      collateralAssetsUsd?: number | null;
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
        ... on MorphoVaultV2Adapter {
          type
          assets
          assetsUsd
          forceDeallocatePenalty
          factory { address }
          innerVault { address name symbol }
        }
      }
      liquidityData {
        __typename
        ... on MarketV1LiquidityData {
          market {
            marketId
            loanAsset { address symbol }
            collateralAsset { address symbol }
            oracle { address }
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
          ... on MorphoVaultV2Adapter {
            type
            assets
            assetsUsd
            forceDeallocatePenalty
            factory { address }
            innerVault { address name symbol }
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
                oracle { address }
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

function mapAdapter(
  graph: GraphAdapter | null | undefined,
  wrapperVaultAddress: string
): AdapterInfo | null {
  if (!graph?.address) return null;

  const underlyingMerged = isMorphoVaultV2Adapter(graph)
    ? mergeUnderlyingVaultInfo(wrapperVaultAddress, graph.innerVault)
    : null;

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
    underlying: underlyingMerged
      ? {
          address: underlyingMerged.address,
          name: underlyingMerged.name,
          symbol: underlyingMerged.symbol,
        }
      : graph.__typename === 'MorphoVaultV2Adapter'
        ? {
            address: graph.innerVault?.address ?? null,
            name: graph.innerVault?.name ?? null,
            symbol: graph.innerVault?.symbol ?? null,
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
        oracleAddress: resolveMarketOracleAddress(data.market),
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

/** Live `liquidityAdapter()` / `liquidityData()`; null when the read fails. */
async function readOnChainLiquidity(
  vault: Address
): Promise<{ adapter: Address; data: Hex } | null> {
  const [adapter, data] = await publicClient.multicall({
    allowFailure: true,
    contracts: [
      { address: vault, abi: vaultV2Abi, functionName: 'liquidityAdapter' },
      { address: vault, abi: vaultV2Abi, functionName: 'liquidityData' },
    ],
  });
  if (adapter?.status !== 'success' || data?.status !== 'success') return null;
  return { adapter: getAddress(adapter.result), data: data.result };
}

/**
 * The Morpho indexer lags `setLiquidityAdapterAndData`, so a post-write refetch
 * would still report the old adapter as current. Prefer the on-chain values and
 * re-derive the display fields from the adapters / caps we already loaded.
 */
function overlayOnChainLiquidity(
  onChain: { adapter: Address; data: Hex },
  graph: { liquidityAdapter: AdapterInfo | null; liquidityData: LiquidityDataInfo | null },
  adapters: AdapterInfo[],
  caps: CapInfo[]
): { liquidityAdapter: AdapterInfo | null; liquidityData: LiquidityDataInfo | null } {
  const adapterLower = onChain.adapter.toLowerCase();
  if (adapterLower === zeroAddress) {
    return { liquidityAdapter: null, liquidityData: null };
  }

  const liquidityAdapter =
    graph.liquidityAdapter?.address?.toLowerCase() === adapterLower
      ? graph.liquidityAdapter
      : adapters.find((a) => a.address.toLowerCase() === adapterLower) ?? {
          address: onChain.adapter,
          type: 'Unknown',
          assets: null,
          assetsUsd: null,
          factoryAddress: null,
          forceDeallocatePenalty: null,
        };

  if (onChain.data === '0x') {
    return { liquidityAdapter, liquidityData: null };
  }

  // Blue adapter data is abi.encode(marketParams); its hash is the market id.
  const marketId = keccak256(onChain.data).toLowerCase();
  if (graph.liquidityData?.kind === 'market' && graph.liquidityData.marketKey?.toLowerCase() === marketId) {
    return { liquidityAdapter, liquidityData: graph.liquidityData };
  }
  const cap = caps.find(
    (c) =>
      isMarketCap(c) &&
      c.marketKey?.toLowerCase() === marketId &&
      (!c.adapterAddress || c.adapterAddress.toLowerCase() === adapterLower)
  );
  return {
    liquidityAdapter,
    liquidityData: {
      kind: 'market',
      marketKey: cap?.marketKey ?? marketId,
      marketParams: cap?.marketParams ?? null,
    },
  };
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
  const denied = await unauthorizedUnlessAdmin(request);
  if (denied) return denied;
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
        ?.map((item) => mapAdapter(item, address))
        .filter((a): a is AdapterInfo => a !== null) ?? [];

    let liquidityAdapter = mapAdapter(data.vault.liquidityAdapter, address);
    let liquidityData = mapLiquidityData(data.vault.liquidityData ?? null);

    const capsRaw =
      data.vault.caps?.items
        ?.map(mapCap)
        .filter((c): c is CapInfo => c !== null) ?? [];

    const enrichedCaps = await enrichCollateralCapSymbols(
      await enrichMarketCapParams(capsRaw, chainId),
      chainId
    );

    let caps = enrichedCaps;
    try {
      caps = await overlayV2OnChainCaps(address, enrichedCaps);
    } catch (overlayError) {
      logger.warn('On-chain cap overlay failed; returning GraphQL caps', {
        vaultAddress: address,
        error: overlayError instanceof Error ? overlayError : new Error(String(overlayError)),
      });
    }

    try {
      const onChainLiquidity = await readOnChainLiquidity(getAddress(address));
      if (onChainLiquidity) {
        ({ liquidityAdapter, liquidityData } = overlayOnChainLiquidity(
          onChainLiquidity,
          { liquidityAdapter, liquidityData },
          adapters,
          caps
        ));
      }
    } catch (liquidityError) {
      logger.warn('On-chain liquidity adapter read failed; returning GraphQL value', {
        vaultAddress: address,
        error: liquidityError instanceof Error ? liquidityError : new Error(String(liquidityError)),
      });
    }

    const timelocks =
      data.vault.timelocks
        ?.map(mapTimelock)
        .filter((t): t is TimelockInfo => t !== null) ?? [];

    const allocators =
      data.vault.allocators
        ?.map((a) => a?.allocator?.address)
        .filter((addr): addr is string => Boolean(addr)) ?? [];

    let publicAllocator: VaultV2PublicAllocatorState | null = null;
    try {
      publicAllocator = await fetchVaultV2PublicAllocatorState(
        address,
        chainId,
        allocators,
        caps
      );
    } catch (paError) {
      logger.warn('Public Allocator overlay failed; omitting PA caps', {
        vaultAddress: address,
        error: paError instanceof Error ? paError : new Error(String(paError)),
      });
    }

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
      liquidityData,
      owner: data.vault.owner?.address ?? null,
      curator: data.vault.curator?.address ?? null,
      allocators,
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
      publicAllocator,
    };

    const responseHeaders = mergeApiOnChainVaultHeaders(rateLimitResult.headers);

    return NextResponse.json(response, { headers: responseHeaders });
  } catch (error) {
    const { error: apiError, statusCode } = handleApiError(error, 'Failed to fetch v2 governance data');
    return NextResponse.json(apiError, { status: statusCode });
  }
}

