import { zeroAddress, type Hex } from 'viem';
import type { VaultV2GovernanceResponse, CapInfo } from '@/app/api/vaults/[id]/governance/route';
import type { V2VaultRiskResponse } from '@/app/api/vaults/[id]/risk/route';
import { isMarketCap } from '@/lib/morpho/cap-utils';
import { encodeMarketParamsData, type MarketParamsInput } from '@/lib/morpho/v2-id-data';
import { formatMarketPairLabel, formatLltvPill } from '@/components/morpho/AllocationListView';
import { marketKeyFromGraphQL, morphoMarketHref } from '@/lib/morpho/morpho-app-links';
import { isMorphoVaultV2Adapter } from '@/lib/morpho/vault-v2-adapter';
import { EMPTY_ADAPTER_DATA } from '@/lib/morpho/v2-id-data';

export type LiquidityAdapterOption = {
  key: string;
  label: string;
  lltv: string | null;
  morphoHref: string | null;
  adapterAddress: string;
  liquidityData: Hex;
  kind: 'market' | 'vault' | 'idle';
  isCurrent: boolean;
};

export function resolveLiquidityDisplay(
  governance: VaultV2GovernanceResponse | null | undefined
): {
  label: string;
  lltv: string | null;
  morphoHref: string | null;
} {
  const adapter = governance?.liquidityAdapter?.address?.toLowerCase() ?? null;
  if (!adapter || adapter === zeroAddress) {
    return { label: 'Idle', lltv: null, morphoHref: null };
  }
  const underlying = governance?.liquidityAdapter?.underlying;
  if (underlying?.address) {
    return {
      label: underlying.name || underlying.symbol || 'Morpho vault',
      lltv: null,
      morphoHref: null,
    };
  }

  const data = governance?.liquidityData;
  if (!data) {
    return { label: 'Not configured', lltv: null, morphoHref: null };
  }

  if (data.kind === 'metaMorpho') {
    const name =
      data.metaMorphoName ||
      data.metaMorphoSymbol ||
      (data.metaMorphoAddress ? `${data.metaMorphoAddress.slice(0, 6)}…` : 'MetaMorpho');
    return { label: name, lltv: null, morphoHref: null };
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

  const byKey = new Map<string, LiquidityAdapterOption>();

  const add = (opt: LiquidityAdapterOption) => {
    if (!byKey.has(opt.key)) byKey.set(opt.key, opt);
  };

  for (const adapter of risk.adapters ?? []) {
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

const IDLE_ADAPTER = zeroAddress;

/**
 * Fee-wrapper liquidity targets: the Morpho vault adapter (data must be empty)
 * or idle (`address(0)`), which leaves withdrawals on unallocated cash.
 */
export function buildVaultOrIdleLiquidityOptions(
  risk: V2VaultRiskResponse,
  governance: VaultV2GovernanceResponse
): LiquidityAdapterOption[] {
  const current = governance.liquidityAdapter?.address?.toLowerCase() ?? null;
  const idleCurrent = !current || current === IDLE_ADAPTER;
  const options: LiquidityAdapterOption[] = [
    {
      key: 'idle',
      label: 'Idle',
      lltv: null,
      morphoHref: null,
      adapterAddress: IDLE_ADAPTER,
      liquidityData: EMPTY_ADAPTER_DATA,
      kind: 'idle',
      isCurrent: idleCurrent,
    },
  ];

  for (const adapter of risk.adapters ?? []) {
    if (!isMorphoVaultV2Adapter(adapter)) continue;
    const address = adapter.adapterAddress;
    options.push({
      key: `vault-${address.toLowerCase()}`,
      label: adapter.underlying?.name || adapter.underlying?.symbol || adapter.adapterLabel,
      lltv: null,
      morphoHref: null,
      adapterAddress: address,
      liquidityData: EMPTY_ADAPTER_DATA,
      kind: 'vault',
      isCurrent: current === address.toLowerCase(),
    });
  }

  options.sort((a, b) => {
    if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
    if (a.kind === 'idle' || b.kind === 'idle') return a.kind === 'idle' ? 1 : -1;
    return a.label.localeCompare(b.label);
  });
  return options;
}
