import { NextRequest, NextResponse } from 'next/server';
import { gql } from 'graphql-request';
import { getAddress, isAddress } from 'viem';
import { morphoGraphQLClient } from '@/lib/morpho/graphql-client';
import { getVaultByAddress } from '@/lib/config/vaults';
import { handleApiError, AppError } from '@/lib/utils/error-handler';
import { createRateLimitMiddleware, RATE_LIMIT_REQUESTS_PER_MINUTE, MINUTE_MS } from '@/lib/utils/rate-limit';
import { BASE_CHAIN_ID, VAULT_V2_GRAPHQL_ADAPTER_LIMIT, VAULT_V2_GRAPHQL_CAPS_LIMIT, VAULT_V2_GRAPHQL_POSITION_LIMIT } from '@/lib/constants';
import {
  asV1VaultMarketData,
  fetchV1VaultMarkets,
  type V1VaultMarketData,
} from '@/lib/morpho/query-v1-vault-markets';
import { isMarketCap } from '@/lib/morpho/cap-utils';
import { isAllocatableMarketCap } from '@/lib/morpho/v2-allocation-targets';
import { mapCap, type GraphCap } from '@/lib/morpho/vault-v2-governance-map';
import { enrichMarketCapParams } from '@/lib/morpho/fetch-markets-by-id';
import { marketKeyFromGraphQL } from '@/lib/morpho/morpho-app-links';
import type { CapInfo } from '@/app/api/vaults/v2/[id]/governance/route';
import {
  computeV1MarketRiskScores,
  isMarketIdle,
  type MarketRiskGrade,
  type MarketRiskScores,
} from '@/lib/morpho/compute-v1-market-risk';
import { getIRMTargetUtilizationWithFallback } from '@/lib/morpho/irm-utils';
import { getOracleTimestampData, getOracleFeedHintsFromMarket, type OracleTimestampData } from '@/lib/morpho/oracle-utils';
import type { Address } from 'viem';

type AdapterType = 'MetaMorphoAdapter' | 'MorphoMarketV1Adapter' | 'Unknown';

type GraphAdapter = {
  __typename?: string | null;
  address: string;
  assetsUsd: number | null;
  assets: string | null;
  type: AdapterType;
  factory?: { address?: string | null } | null;
  metaMorpho?: { address?: string | null; name?: string | null; symbol?: string | null } | null;
  positions?: {
    items: Array<{
      state?: {
        supplyAssets?: string | null;
        supplyAssetsUsd?: number | null;
        borrowAssetsUsd?: number | null;
        collateralAssetsUsd?: number | null;
        liquidityAssetsUsd?: number | null;
        utilization?: number | null;
      } | null;
      market: V1VaultMarketData;
    } | null>;
  } | null;
};

type GraphVaultResponse = {
  vault?: {
    address?: string | null;
    totalAssetsUsd?: number | null;
    idleAssets?: string | number | null;
    idleAssetsUsd?: number | null;
    liquidityUsd?: number | null;
    asset?: { symbol?: string; decimals?: number } | null;
    adapters?: {
      items?: Array<GraphAdapter | null> | null;
    } | null;
    caps?: {
      items?: Array<GraphCap | null> | null;
    } | null;
  } | null;
};

export type V2MarketRiskData = {
  market: V1VaultMarketData;
  scores: MarketRiskScores | null;
  allocationUsd: number;
  allocationAssets: string | null;
  oracleTimestampData?: OracleTimestampData | null;
  absoluteCap?: string | null;
  relativeCap?: string | null;
};

export type V2UnderlyingVaultStats = {
  netApy: number | null;
  totalAssetsUsd: number | null;
  totalAssets: string | null;
  liquidityUsd: number | null;
  liquidityUnderlying: string | null;
};

export type V2AdapterRiskData = {
  adapterAddress: string;
  adapterType: AdapterType;
  adapterLabel: string;
  allocationUsd: number;
  allocationAssets: string | null;
  riskScore: number;
  riskGrade: MarketRiskGrade;
  markets: V2MarketRiskData[];
  underlyingVaultAddress?: string | null;
  underlyingVaultStats?: V2UnderlyingVaultStats | null;
  absoluteCap?: string | null;
  relativeCap?: string | null;
};

export type V2VaultRiskResponse = {
  vaultAddress: string;
  totalAdapterAssetsUsd: number;
  idleAssets: string | null;
  idleAssetsUsd: number | null;
  vaultRiskScore: number;
  vaultRiskGrade: MarketRiskGrade;
  vaultAsset: { symbol: string; decimals: number } | null;
  adapters: V2AdapterRiskData[];
};

const ADAPTER_LIMIT = VAULT_V2_GRAPHQL_ADAPTER_LIMIT;
const POSITION_LIMIT = VAULT_V2_GRAPHQL_POSITION_LIMIT;
const CAPS_LIMIT = VAULT_V2_GRAPHQL_CAPS_LIMIT;

const VAULT_V2_RISK_QUERY = gql`
  query VaultV2Risk($address: String!, $chainId: Int!, $adapterLimit: Int!, $positionLimit: Int!, $capLimit: Int!) {
    vault: vaultV2ByAddress(address: $address, chainId: $chainId) {
      address
      totalAssetsUsd
      idleAssets
      idleAssetsUsd
      liquidityUsd
      asset { symbol decimals }
      adapters(first: $adapterLimit) {
        items {
          __typename
          address
          ... on MetaMorphoAdapter {
            assets
            assetsUsd
            type
            factory { address }
            metaMorpho { address name symbol }
          }
          ... on MorphoMarketV1Adapter {
            assets
            assetsUsd
            type
            positions(first: $positionLimit) {
              items {
                state {
                  supplyAssets
                  supplyAssetsUsd
                }
                market {
                  id
                  marketId
                  loanAsset { symbol decimals address }
                  collateralAsset { symbol decimals address }
                  oracleAddress
                  oracle {
                    data {
                      ... on MorphoChainlinkOracleV2Data {
                        baseFeedOne { address }
                      }
                      ... on MorphoChainlinkOracleData {
                        baseFeedOne { address }
                      }
                    }
                  }
                  irmAddress
                  lltv
                  realizedBadDebt { usd }
                  state {
                    supplyAssetsUsd
                    borrowAssetsUsd
                    collateralAssetsUsd
                    liquidityAssetsUsd
                    utilization
                    supplyApy
                    borrowApy
                  }
                }
              }
            }
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
                  liquidityAssetsUsd
                }
              }
            }
          }
        }
      }
    }
  }
`;

function getGradeFromScore(score: number): MarketRiskGrade {
  if (score >= 93) return 'A+';
  if (score >= 90) return 'A';
  if (score >= 87) return 'A−';
  if (score >= 84) return 'B+';
  if (score >= 80) return 'B';
  if (score >= 77) return 'B−';
  if (score >= 74) return 'C+';
  if (score >= 70) return 'C';
  if (score >= 65) return 'C−';
  if (score >= 60) return 'D';
  return 'F';
}

async function buildMarketRisk(
  market: V1VaultMarketData,
  supplyUsd: number | null | undefined,
  supplyAssets?: string | null
): Promise<V2MarketRiskData> {
  const baseFeedHints = getOracleFeedHintsFromMarket(market);

  const [oracleTimestampData, targetUtilization] = await Promise.all([
    getOracleTimestampData(
      market.oracleAddress ? (market.oracleAddress as Address) : null,
      baseFeedHints
    ),
    getIRMTargetUtilizationWithFallback(
      market.irmAddress ? (market.irmAddress as Address) : null
    ),
  ]);

  const computedScores = isMarketIdle(market)
    ? null
    : await computeV1MarketRiskScores(
      market,
      oracleTimestampData,
      targetUtilization
    );

  const allocationAssets =
    supplyAssets ?? (market as unknown as { vaultSupplyAssets?: string | null }).vaultSupplyAssets ?? null;

  return {
    market,
    scores: computedScores,
    allocationUsd: supplyUsd ?? 0,
    allocationAssets,
    oracleTimestampData,
  };
}

function sumPositionSupplyAssetsUsd(
  positions: NonNullable<GraphAdapter['positions']>['items']
): number {
  if (!positions?.length) return 0;
  return positions.reduce((sum, p) => sum + (p?.state?.supplyAssetsUsd ?? 0), 0);
}

function sumPositionSupplyAssetsRaw(
  positions: NonNullable<GraphAdapter['positions']>['items']
): string | null {
  if (!positions?.length) return null;
  try {
    let total = 0n;
    for (const p of positions) {
      const raw = p?.state?.supplyAssets;
      if (raw == null) continue;
      total += BigInt(raw);
    }
    return total.toString();
  } catch {
    return null;
  }
}

function capToV1VaultMarketData(cap: CapInfo): V1VaultMarketData | null {
  if (!cap.marketKey || !cap.marketParams) return null;
  const loan = cap.marketParams.loanAsset;
  const col = cap.marketParams.collateralAsset;
  if (!loan?.address || !col?.address) return null;

  let vaultSupplyAssets: string | null = null;
  try {
    const raw = BigInt(cap.allocation ?? '0');
    vaultSupplyAssets = raw > 0n ? raw.toString() : null;
  } catch {
    vaultSupplyAssets = null;
  }

  return asV1VaultMarketData({
    id: cap.marketKey,
    marketId: cap.marketKey,
    uniqueKey: cap.marketKey,
    loanAsset: {
      address: loan.address,
      symbol: loan.symbol ?? 'Unknown',
      decimals: loan.decimals ?? 18,
    },
    collateralAsset: {
      address: col.address,
      symbol: col.symbol ?? 'Unknown',
      decimals: col.decimals ?? 18,
    },
    oracleAddress: cap.marketParams.oracleAddress ?? null,
    oracle: null,
    irmAddress: cap.marketParams.irmAddress ?? null,
    lltv: cap.marketParams.lltv ?? null,
    realizedBadDebt: null,
    state: cap.marketParams.state
      ? {
          supplyAssetsUsd: null,
          borrowAssetsUsd: null,
          collateralAssetsUsd: null,
          liquidityAssetsUsd: cap.marketParams.state.liquidityAssetsUsd ?? null,
          utilization: cap.marketParams.state.utilization ?? null,
          supplyApy: cap.marketParams.state.supplyApy ?? null,
          borrowApy: cap.marketParams.state.borrowApy ?? null,
        }
      : null,
    vaultSupplyAssets,
    vaultSupplyAssetsUsd: null,
    vaultTotalAssetsUsd: null,
    marketTotalSupplyUsd: null,
  });
}

function marketCapsForAdapter(adapterAddress: string, caps: CapInfo[]): CapInfo[] {
  const addr = adapterAddress.toLowerCase();
  return caps.filter(
    (cap) =>
      isMarketCap(cap) &&
      isAllocatableMarketCap(cap) &&
      cap.adapterAddress?.toLowerCase() === addr &&
      Boolean(cap.marketKey)
  );
}

async function buildBlueAdapterMarketRisks(
  adapter: GraphAdapter,
  positions: NonNullable<GraphAdapter['positions']>['items'],
  caps: CapInfo[]
): Promise<V2MarketRiskData[]> {
  const adapterAddress = adapter.address;
  const adapterCaps = marketCapsForAdapter(adapterAddress, caps);

  const positionByKey = new Map<
    string,
    NonNullable<NonNullable<GraphAdapter['positions']>['items'][number]>
  >();
  for (const pos of positions) {
    if (!pos?.market) continue;
    const key = marketKeyFromGraphQL(pos.market)?.toLowerCase();
    if (key) positionByKey.set(key, pos);
  }

  const keys = new Set<string>();
  for (const cap of adapterCaps) {
    if (cap.marketKey) keys.add(cap.marketKey.toLowerCase());
  }

  const marketRisks: V2MarketRiskData[] = [];
  for (const key of keys) {
    const cap = adapterCaps.find((c) => c.marketKey?.toLowerCase() === key);
    const pos = positionByKey.get(key);

    let market: V1VaultMarketData | null = null;
    let supplyUsd = 0;
    let supplyAssets: string | null = null;

    if (pos?.market) {
      market = asV1VaultMarketData(pos.market);
      supplyUsd = pos.state?.supplyAssetsUsd ?? 0;
      supplyAssets = pos.state?.supplyAssets ?? null;
    } else if (cap) {
      market = capToV1VaultMarketData(cap);
      if (cap.allocation) {
        try {
          const raw = BigInt(cap.allocation);
          if (raw > 0n) supplyAssets = raw.toString();
        } catch {
          /* skip */
        }
      }
    }

    if (!market) continue;

    const capFields = cap
      ? { absoluteCap: cap.absoluteCap, relativeCap: cap.relativeCap }
      : {};

    marketRisks.push({
      ...(await buildMarketRisk(market, supplyUsd, supplyAssets)),
      ...capFields,
    });
  }

  return marketRisks;
}

async function computeAdapterRisk(
  adapter: GraphAdapter,
  chainId: number,
  caps: CapInfo[]
): Promise<V2AdapterRiskData | null> {
  const posItems = adapter.positions?.items ?? null;
  const allocationUsd =
    adapter.__typename === 'MorphoMarketV1Adapter' && posItems
      ? sumPositionSupplyAssetsUsd(posItems)
      : (adapter.assetsUsd ?? 0);

  if (adapter.__typename === 'MetaMorphoAdapter' && adapter.metaMorpho?.address) {
    const { markets, vaultStats } = await fetchV1VaultMarkets(adapter.metaMorpho.address, chainId);
    const marketRisks = await Promise.all(
      markets.map((m) => buildMarketRisk(m, m.vaultSupplyAssetsUsd ?? 0, m.vaultSupplyAssets ?? null))
    );

    const { weightedScore, grade } = computeWeightedRisk(marketRisks);

    return {
      adapterAddress: adapter.address,
      adapterType: 'MetaMorphoAdapter',
      adapterLabel: adapter.metaMorpho.name ?? adapter.metaMorpho.symbol ?? 'MetaMorpho Adapter',
      allocationUsd,
      allocationAssets: adapter.assets ?? null,
      riskScore: weightedScore,
      riskGrade: grade,
      markets: marketRisks,
      underlyingVaultAddress: adapter.metaMorpho.address,
      underlyingVaultStats: {
        netApy: vaultStats.netApy,
        totalAssetsUsd: vaultStats.totalAssetsUsd,
        totalAssets: vaultStats.totalAssets,
        liquidityUsd: vaultStats.liquidityUsd,
        liquidityUnderlying: vaultStats.liquidityUnderlying,
      },
    };
  }

  if (adapter.__typename === 'MorphoMarketV1Adapter') {
    const positions = adapter.positions?.items?.filter(Boolean) ?? [];
    const marketRisks = await buildBlueAdapterMarketRisks(adapter, positions, caps);
    const { weightedScore, grade } = computeWeightedRisk(marketRisks);

    return {
      adapterAddress: adapter.address,
      adapterType: 'MorphoMarketV1Adapter',
      adapterLabel: 'Morpho Market Adapter',
      allocationUsd,
      allocationAssets: adapter.assets ?? null,
      riskScore: marketRisks.length > 0 ? weightedScore : 0,
      riskGrade: marketRisks.length > 0 ? grade : 'F',
      markets: marketRisks,
    };
  }

  return null;
}

function computeWeightedRisk(markets: V2MarketRiskData[]): { weightedScore: number; grade: MarketRiskGrade } {
  let weightedSum = 0;
  let totalWeight = 0;

  markets.forEach((m) => {
    if (m.scores && !isMarketIdle(m.market) && m.allocationUsd > 0) {
      weightedSum += m.scores.marketRiskScore * m.allocationUsd;
      totalWeight += m.allocationUsd;
    }
  });

  if (totalWeight === 0) {
    let scoreSum = 0;
    let scoreCount = 0;
    markets.forEach((m) => {
      if (m.scores && !isMarketIdle(m.market)) {
        scoreSum += m.scores.marketRiskScore;
        scoreCount += 1;
      }
    });
    const avgScore = scoreCount > 0 ? scoreSum / scoreCount : 0;
    return {
      weightedScore: avgScore,
      grade: getGradeFromScore(avgScore),
    };
  }

  const weightedScore = weightedSum / totalWeight;
  return {
    weightedScore,
    grade: getGradeFromScore(weightedScore),
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
    if (!cfg) {
      throw new AppError('Vault not found in configuration', 404, 'VAULT_NOT_FOUND');
    }

    const data = await morphoGraphQLClient.request<GraphVaultResponse>(
      VAULT_V2_RISK_QUERY,
      {
        address,
        chainId: cfg.chainId ?? BASE_CHAIN_ID,
        adapterLimit: ADAPTER_LIMIT,
        positionLimit: POSITION_LIMIT,
        capLimit: CAPS_LIMIT,
      }
    );

    if (!data.vault) {
      throw new AppError('Vault not found in Morpho API', 404, 'VAULT_NOT_FOUND');
    }

    const capsRaw =
      data.vault.caps?.items
        ?.map(mapCap)
        .filter((c): c is CapInfo => c !== null) ?? [];
    const caps = await enrichMarketCapParams(capsRaw, cfg.chainId ?? BASE_CHAIN_ID);

    const adapters = data.vault.adapters?.items?.filter((a): a is GraphAdapter => Boolean(a)) ?? [];

    const adapterRisks = (
      await Promise.all(adapters.map((adapter) => computeAdapterRisk(adapter, cfg.chainId, caps)))
    ).filter((a): a is V2AdapterRiskData => a !== null);

    const totalAdapterAssetsUsd = adapterRisks.reduce(
      (sum, a) => sum + (a.allocationUsd ?? 0),
      0
    );

    // Calculate weighted risk score in a single reduce pass
    const vaultWeightedSum = adapterRisks.reduce((sum, adapter) => {
      if (adapter.allocationUsd > 0) {
        return sum + adapter.riskScore * adapter.allocationUsd;
      }
      return sum;
    }, 0);

    const vaultRiskScore =
      totalAdapterAssetsUsd > 0 ? vaultWeightedSum / totalAdapterAssetsUsd : 0;

    const vaultAsset = data.vault?.asset
      ? { symbol: data.vault.asset.symbol ?? 'UNKNOWN', decimals: data.vault.asset.decimals ?? 18 }
      : null;

    const response: V2VaultRiskResponse = {
      vaultAddress: address,
      totalAdapterAssetsUsd,
      idleAssets:
        data.vault.idleAssets != null && data.vault.idleAssets !== undefined
          ? String(data.vault.idleAssets)
          : null,
      idleAssetsUsd: data.vault.idleAssetsUsd ?? null,
      vaultRiskScore,
      vaultRiskGrade: getGradeFromScore(vaultRiskScore),
      vaultAsset,
      adapters: adapterRisks,
    };

    const responseHeaders = new Headers(rateLimitResult.headers);
    responseHeaders.set('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=300');

    return NextResponse.json(response, { headers: responseHeaders });
  } catch (error) {
    const { error: apiError, statusCode } = handleApiError(error);
    return NextResponse.json(apiError, { status: statusCode });
  }
}

