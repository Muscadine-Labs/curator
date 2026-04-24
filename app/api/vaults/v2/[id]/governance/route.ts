import { NextRequest, NextResponse } from 'next/server';
import { gql } from 'graphql-request';
import { getAddress, isAddress } from 'viem';
import { morphoGraphQLClient } from '@/lib/morpho/graphql-client';
import { getVaultByAddress } from '@/lib/config/vaults';
import { handleApiError, AppError } from '@/lib/utils/error-handler';
import { createRateLimitMiddleware, RATE_LIMIT_REQUESTS_PER_MINUTE, MINUTE_MS } from '@/lib/utils/rate-limit';
import { BASE_CHAIN_ID } from '@/lib/constants';

type GraphAdapter = {
  __typename?: 'MetaMorphoAdapter' | 'MorphoMarketV1Adapter' | string | null;
  address?: string | null;
  type?: string | null;
  assets?: number | string | null;
  assetsUsd?: number | null;
  factory?: { address?: string | null } | null;
  metaMorpho?: { address?: string | null; name?: string | null; symbol?: string | null } | null;
};

type GraphCap = {
  type?: string | null;
  absoluteCap?: string | number | null;
  relativeCap?: string | number | null;
  allocation?: string | number | null;
  data?: (
    | { __typename?: 'AdapterCapData'; adapterAddress?: string | null }
    | {
        __typename?: 'MarketV1CapData';
        adapterAddress?: string | null;
        market?: { uniqueKey?: string | null } | null;
      }
    | { __typename?: 'CollateralCapData'; collateralAddress?: string | null }
    | { __typename?: string | null }
    | null
  ) | null;
};

type GraphVaultGovernanceResponse = {
  vault?: {
    address?: string | null;
    owner?: { address?: string | null } | null;
    curator?: { address?: string | null } | null;
    allocators?: Array<{ allocator?: { address?: string | null } | null } | null> | null;
    sentinels?: Array<{ sentinel?: { address?: string | null } | null } | null> | null;
    liquidityAdapter?: GraphAdapter | null;
    adapters?: { items?: Array<GraphAdapter | null> | null } | null;
    caps?: { items?: Array<GraphCap | null> | null } | null;
    timelocks?: Array<{ selector?: string | null; functionName?: string | null; duration?: number | string | null } | null> | null;
  } | null;
};

export type VaultV2GovernanceResponse = {
  vaultAddress: string;
  owner: string | null;
  curator: string | null;
  allocators: string[];
  sentinels: string[];
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
};

export type TimelockInfo = {
  selector: string;
  functionName: string;
  durationSeconds: number;
};

const ADAPTER_LIMIT = 50;

const VAULT_V2_GOVERNANCE_QUERY = gql`
  query VaultV2Governance($address: String!, $chainId: Int!, $adapterLimit: Int!) {
    vault: vaultV2ByAddress(address: $address, chainId: $chainId) {
      address
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
          factory { address }
          metaMorpho { address name symbol }
        }
        ... on MorphoMarketV1Adapter {
          type
          assets
          assetsUsd
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
            factory { address }
            metaMorpho { address name symbol }
          }
          ... on MorphoMarketV1Adapter {
            type
            assets
            assetsUsd
          }
        }
      }
      caps(first: $adapterLimit) {
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
              market { uniqueKey }
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
    metaMorpho: graph.__typename === 'MetaMorphoAdapter'
      ? {
          address: graph.metaMorpho?.address ?? null,
          name: graph.metaMorpho?.name ?? null,
          symbol: graph.metaMorpho?.symbol ?? null,
        }
      : null,
  };
}

function mapCap(graph: GraphCap | null | undefined): CapInfo | null {
  if (!graph) return null;

  const base: CapInfo = {
    type: graph.type ?? 'Unknown',
    absoluteCap:
      graph.absoluteCap === null || graph.absoluteCap === undefined
        ? '0'
        : typeof graph.absoluteCap === 'string'
        ? graph.absoluteCap
        : graph.absoluteCap.toString(),
    relativeCap:
      graph.relativeCap === null || graph.relativeCap === undefined
        ? '0'
        : typeof graph.relativeCap === 'string'
        ? graph.relativeCap
        : graph.relativeCap.toString(),
    allocation:
      graph.allocation === null || graph.allocation === undefined
        ? '0'
        : typeof graph.allocation === 'string'
        ? graph.allocation
        : graph.allocation.toString(),
  };

  if (graph.data?.__typename === 'AdapterCapData') {
    const adapterData = graph.data as { __typename?: string | null; adapterAddress?: string | null };
    return { ...base, adapterAddress: adapterData.adapterAddress ?? null };
  }

  if (graph.data?.__typename === 'MarketV1CapData') {
    const marketData = graph.data as {
      __typename?: string | null;
      adapterAddress?: string | null;
      market?: { uniqueKey?: string | null } | null;
    };
    return {
      ...base,
      adapterAddress: marketData.adapterAddress ?? null,
      marketKey: marketData.market?.uniqueKey ?? null,
    };
  }

  if (graph.data?.__typename === 'CollateralCapData') {
    const collateralData = graph.data as { __typename?: string | null; collateralAddress?: string | null };
    return { ...base, collateralAddress: collateralData.collateralAddress ?? null };
  }

  return base;
}

function mapTimelock(entry: { selector?: string | null; functionName?: string | null; duration?: number | string | null } | null | undefined): TimelockInfo | null {
  if (!entry?.selector || !entry.functionName) return null;

  return {
    selector: entry.selector,
    functionName: entry.functionName,
    durationSeconds:
      entry.duration === null || entry.duration === undefined
        ? 0
        : typeof entry.duration === 'string'
        ? Number(entry.duration)
        : entry.duration,
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

    const caps =
      data.vault.caps?.items
        ?.map(mapCap)
        .filter((c): c is CapInfo => c !== null) ?? [];

    const timelocks =
      data.vault.timelocks
        ?.map(mapTimelock)
        .filter((t): t is TimelockInfo => t !== null) ?? [];

    const response: VaultV2GovernanceResponse = {
      vaultAddress: address,
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
      liquidityAdapter,
      adapters,
      caps,
      timelocks,
    };

    const responseHeaders = new Headers(rateLimitResult.headers);
    responseHeaders.set('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=300');

    return NextResponse.json(response, { headers: responseHeaders });
  } catch (error) {
    const { error: apiError, statusCode } = handleApiError(error, 'Failed to fetch v2 governance data');
    return NextResponse.json(apiError, { status: statusCode });
  }
}

