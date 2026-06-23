import type { Hex } from 'viem';
import type { VaultV2GovernanceResponse, CapInfo } from '@/app/api/vaults/v2/[id]/governance/route';
import type { V2VaultRiskResponse } from '@/app/api/vaults/v2/[id]/risk/route';
import { isMarketCap } from '@/lib/morpho/cap-utils';
import {
  encodeMarketParamsData,
  METAMORPHO_ADAPTER_DATA,
  type MarketParamsInput,
} from '@/lib/morpho/v2-id-data';
import { formatMarketPairLabel, formatLltvPill } from '@/components/morpho/AllocationListView';
import { marketKeyFromGraphQL, morphoMarketHref, morphoVaultHref } from '@/lib/morpho/morpho-app-links';

export type LiquidityAdapterOption = {
  key: string;
  label: string;
  lltv: string | null;
  morphoHref: string | null;
  adapterAddress: string;
  liquidityData: Hex;
  kind: 'market' | 'metaMorpho';
  isCurrent: boolean;
};

export function resolveLiquidityDisplay(
  governance: VaultV2GovernanceResponse | null | undefined
): {
  label: string;
  lltv: string | null;
  morphoHref: string | null;
} {
  const data = governance?.liquidityData;
  if (!data) {
    return { label: 'Not configured', lltv: null, morphoHref: null };
  }

  if (data.kind === 'metaMorpho') {
    const name =
      data.metaMorphoName ||
      data.metaMorphoSymbol ||
      (data.metaMorphoAddress ? `${data.metaMorphoAddress.slice(0, 6)}…` : 'MetaMorpho');
    return {
      label: name,
      lltv: null,
      morphoHref: morphoVaultHref(data.metaMorphoAddress),
    };
  }

  const col = data.marketParams?.collateralAsset?.symbol;
  const loan = data.marketParams?.loanAsset?.symbol;
  return {
    label: formatMarketPairLabel(col, loan),
    lltv: formatLltvPill(data.marketParams?.lltv ?? null),
    morphoHref: data.marketKey ? morphoMarketHref(data.marketKey) : null,
  };
}

function capToMarketInput(cap: CapInfo): MarketParamsInput | null {
  if (!cap.marketParams?.loanAsset?.address || !cap.marketParams.collateralAsset?.address) {
    return null;
  }
  return {
    loanAsset: cap.marketParams.loanAsset,
    collateralAsset: cap.marketParams.collateralAsset,
    oracleAddress: cap.marketParams.oracleAddress,
    irmAddress: cap.marketParams.irmAddress,
    lltv: cap.marketParams.lltv,
  };
}

function optionFromMarket(
  adapterAddress: string,
  market: MarketParamsInput & {
    marketKey?: string | null;
    loanAsset?: { address: string; symbol?: string | null } | null;
    collateralAsset?: { address: string; symbol?: string | null } | null;
  },
  currentAdapter: string | null,
  currentMarketKey: string | null | undefined
): LiquidityAdapterOption {
  const marketKey = market.marketKey ?? null;
  const label = formatMarketPairLabel(
    market.collateralAsset?.symbol,
    market.loanAsset?.symbol
  );
  const liquidityData = encodeMarketParamsData(market);
  const key = `${adapterAddress.toLowerCase()}-${marketKey ?? liquidityData}`;
  const isCurrent =
    currentAdapter != null &&
    adapterAddress.toLowerCase() === currentAdapter &&
    marketKey != null &&
    currentMarketKey != null &&
    marketKey.toLowerCase() === currentMarketKey.toLowerCase();

  return {
    key,
    label,
    lltv: formatLltvPill(market.lltv ?? null),
    morphoHref: marketKey ? morphoMarketHref(marketKey) : null,
    adapterAddress,
    liquidityData,
    kind: 'market',
    isCurrent,
  };
}

export function buildLiquidityAdapterOptions(
  risk: V2VaultRiskResponse,
  governance: VaultV2GovernanceResponse
): LiquidityAdapterOption[] {
  const currentAdapter = governance.liquidityAdapter?.address?.toLowerCase() ?? null;
  const currentData = governance.liquidityData;
  const currentMarketKey =
    currentData?.kind === 'market' ? currentData.marketKey?.toLowerCase() ?? null : null;
  const currentMeta =
    currentData?.kind === 'metaMorpho'
      ? currentData.metaMorphoAddress?.toLowerCase() ?? null
      : null;

  const byKey = new Map<string, LiquidityAdapterOption>();

  const add = (opt: LiquidityAdapterOption) => {
    if (!byKey.has(opt.key)) byKey.set(opt.key, opt);
  };

  for (const adapter of risk.adapters ?? []) {
    if (adapter.adapterType === 'MetaMorphoAdapter') {
      const underlying = adapter.underlyingVaultAddress?.toLowerCase() ?? '';
      const isCurrent =
        currentAdapter != null &&
        adapter.adapterAddress.toLowerCase() === currentAdapter &&
        currentMeta != null &&
        underlying === currentMeta;
      add({
        key: `meta-${adapter.adapterAddress.toLowerCase()}`,
        label: adapter.adapterLabel || 'MetaMorpho',
        lltv: null,
        morphoHref: morphoVaultHref(adapter.underlyingVaultAddress),
        adapterAddress: adapter.adapterAddress,
        liquidityData: METAMORPHO_ADAPTER_DATA,
        kind: 'metaMorpho',
        isCurrent,
      });
      continue;
    }

    for (const m of adapter.markets ?? []) {
      if (!m.market) continue;
      const marketKey = marketKeyFromGraphQL(m.market);
      add(
        optionFromMarket(
          adapter.adapterAddress,
          { ...m.market, marketKey },
          currentAdapter,
          currentMarketKey
        )
      );
    }
  }

  for (const cap of governance.caps ?? []) {
    if (!isMarketCap(cap) || !cap.adapterAddress) continue;
    const market = capToMarketInput(cap);
    if (!market) continue;
    add(
      optionFromMarket(
        cap.adapterAddress,
        { ...market, marketKey: cap.marketKey },
        currentAdapter,
        currentMarketKey
      )
    );
  }

  const options = [...byKey.values()];
  options.sort((a, b) => {
    if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
    return a.label.localeCompare(b.label);
  });
  return options;
}
