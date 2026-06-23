import type { CapInfo } from '@/app/api/vaults/v2/[id]/governance/route';

export type GraphCap = {
  type?: string | null;
  absoluteCap?: string | number | null;
  relativeCap?: string | number | null;
  allocation?: string | number | null;
  data?: (
    | { __typename?: 'AdapterCapData'; adapterAddress?: string | null }
    | {
        __typename?: 'MarketV1CapData';
        adapterAddress?: string | null;
        market?: {
          marketId?: string | null;
          loanAsset?: { address?: string | null; symbol?: string | null; decimals?: number | null } | null;
          collateralAsset?: { address?: string | null; symbol?: string | null; decimals?: number | null } | null;
          oracleAddress?: string | null;
          irmAddress?: string | null;
          lltv?: string | number | null;
          state?: {
            supplyApy?: number | null;
            borrowApy?: number | null;
            utilization?: number | null;
            liquidityAssetsUsd?: number | null;
          } | null;
        } | null;
      }
    | { __typename?: 'CollateralCapData'; collateralAddress?: string | null }
    | { __typename?: string | null }
    | null
  ) | null;
};

export function mapCap(graph: GraphCap | null | undefined): CapInfo | null {
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
      market?: {
        marketId?: string | null;
        loanAsset?: { address?: string | null; symbol?: string | null; decimals?: number | null } | null;
        collateralAsset?: { address?: string | null; symbol?: string | null; decimals?: number | null } | null;
        oracleAddress?: string | null;
        irmAddress?: string | null;
        lltv?: string | number | null;
        state?: {
          supplyApy?: number | null;
          borrowApy?: number | null;
          utilization?: number | null;
          liquidityAssetsUsd?: number | null;
        } | null;
      } | null;
    };
    const m = marketData.market;
    const marketParams =
      m?.loanAsset?.address && m?.collateralAsset?.address
        ? {
            loanAsset: {
              address: m.loanAsset.address,
              symbol: m.loanAsset.symbol ?? null,
              decimals: m.loanAsset.decimals ?? null,
            },
            collateralAsset: {
              address: m.collateralAsset.address,
              symbol: m.collateralAsset.symbol ?? null,
              decimals: m.collateralAsset.decimals ?? null,
            },
            oracleAddress: m.oracleAddress ?? null,
            irmAddress: m.irmAddress ?? null,
            lltv: m.lltv != null ? String(m.lltv) : null,
            state: m.state ?? null,
          }
        : null;
    return {
      ...base,
      adapterAddress: marketData.adapterAddress ?? null,
      marketKey: m?.marketId ?? null,
      marketParams,
    };
  }

  if (graph.data?.__typename === 'CollateralCapData') {
    const collateralData = graph.data as {
      __typename?: string | null;
      collateralAddress?: string | null;
    };
    return { ...base, collateralAddress: collateralData.collateralAddress ?? null };
  }

  return base;
}
