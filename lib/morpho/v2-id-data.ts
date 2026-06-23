import {
  encodeAbiParameters,
  parseAbiParameters,
  type Address,
  type Hex,
} from 'viem';
import type { CapInfo } from '@/app/api/vaults/v2/[id]/governance/route';
import type { V2VaultRiskResponse } from '@/app/api/vaults/v2/[id]/risk/route';
import { isAdapterCap, isCollateralCap, isMarketCap } from '@/lib/morpho/cap-utils';
import { marketKeyFromGraphQL } from '@/lib/morpho/morpho-app-links';

export type MarketParamsInput = {
  loanAsset?: { address: string } | null;
  collateralAsset?: { address: string } | null;
  oracleAddress?: string | null;
  oracle?: { address?: string | null } | null;
  irmAddress?: string | null;
  lltv?: string | number | null;
};

const MARKET_PARAMS_ABI = parseAbiParameters(
  'address, address, address, address, uint256'
);

/** MetaMorpho adapter allocate/deallocate calldata — empty bytes. */
export const METAMORPHO_ADAPTER_DATA = '0x' as Hex;

function resolveOracleAddress(market: MarketParamsInput): Address {
  const oracle =
    market.oracleAddress ||
    market.oracle?.address ||
    '0x0000000000000000000000000000000000000000';
  return oracle as Address;
}

export function resolveMarketParamsTuple(
  market: MarketParamsInput
): readonly [Address, Address, Address, Address, bigint] {
  const loan = (market.loanAsset?.address ||
    '0x0000000000000000000000000000000000000000') as Address;
  const col = (market.collateralAsset?.address ||
    '0x0000000000000000000000000000000000000000') as Address;
  const oracle = resolveOracleAddress(market);
  const irm = (market.irmAddress ||
    '0x0000000000000000000000000000000000000000') as Address;
  const lltv = market.lltv != null ? BigInt(market.lltv) : 0n;
  return [loan, col, oracle, irm, lltv];
}

/** MorphoMarketV1Adapter allocate/deallocate `data` = abi.encode(marketParams). */
export function encodeMarketParamsData(market: MarketParamsInput): Hex {
  const [loan, col, oracle, irm, lltv] = resolveMarketParamsTuple(market);
  return encodeAbiParameters(MARKET_PARAMS_ABI, [loan, col, oracle, irm, lltv]);
}

/** Adapter cap idData = abi.encode("this", adapterAddress). */
export function encodeAdapterCapIdData(adapterAddress: string): Hex {
  return encodeAbiParameters(parseAbiParameters('string, address'), [
    'this',
    adapterAddress as Address,
  ]);
}

/** Collateral cap idData = abi.encode("collateralToken", collateralAddress). */
export function encodeCollateralCapIdData(collateralAddress: string): Hex {
  return encodeAbiParameters(parseAbiParameters('string, address'), [
    'collateralToken',
    collateralAddress as Address,
  ]);
}

/** Market cap idData = abi.encode("this/marketParams", adapterAddress, marketParams). */
export function encodeMarketCapIdData(
  adapterAddress: string,
  market: MarketParamsInput
): Hex {
  return encodeAbiParameters(
    parseAbiParameters('string, address, (address,address,address,address,uint256)'),
    ['this/marketParams', adapterAddress as Address, resolveMarketParamsTuple(market)]
  );
}

function findMarketByKey(
  risk: V2VaultRiskResponse,
  marketKey: string
): { adapterAddress: string; market: MarketParamsInput } | null {
  const needle = marketKey.toLowerCase();
  for (const adapter of risk.adapters ?? []) {
    for (const m of adapter.markets ?? []) {
      const key = marketKeyFromGraphQL(m.market);
      if (key?.toLowerCase() === needle) {
        return { adapterAddress: adapter.adapterAddress, market: m.market };
      }
    }
  }
  return null;
}

/** Resolve cap idData bytes for decreaseAbsoluteCap / decreaseRelativeCap. */
export function resolveCapIdData(
  cap: CapInfo,
  risk: V2VaultRiskResponse | null | undefined
): Hex | null {
  if (isAdapterCap(cap) && cap.adapterAddress) {
    return encodeAdapterCapIdData(cap.adapterAddress);
  }

  if (isCollateralCap(cap) && cap.collateralAddress) {
    return encodeCollateralCapIdData(cap.collateralAddress);
  }

  if (isMarketCap(cap) && cap.marketKey && cap.adapterAddress) {
    if (cap.marketParams) {
      return encodeMarketCapIdData(cap.adapterAddress, cap.marketParams);
    }

    if (risk) {
      const match = findMarketByKey(risk, cap.marketKey);
      if (match) {
        return encodeMarketCapIdData(match.adapterAddress, match.market);
      }
      // Fallback: scan adapter from cap.adapterAddress when findMarketByKey misses
      for (const adapter of risk.adapters ?? []) {
        if (adapter.adapterAddress.toLowerCase() !== cap.adapterAddress.toLowerCase()) {
          continue;
        }
        for (const m of adapter.markets ?? []) {
          const key = marketKeyFromGraphQL(m.market);
          if (key?.toLowerCase() === cap.marketKey.toLowerCase()) {
            return encodeMarketCapIdData(adapter.adapterAddress, m.market);
          }
        }
      }
    }
  }

  return null;
}
