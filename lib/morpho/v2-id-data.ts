import {
  encodeAbiParameters,
  parseAbiParameters,
  type Address,
  type Hex,
} from 'viem';
import type { CapInfo } from '@/app/api/vaults/v2/[id]/governance/route';
import type { V2VaultRiskResponse } from '@/app/api/vaults/v2/[id]/risk/route';
import { marketKeyFromGraphQL } from '@/lib/morpho/morpho-app-links';

export function encodeMarketIdData(market: {
  loanAsset?: { address: string } | null;
  collateralAsset?: { address: string } | null;
  oracleAddress?: string | null;
  irmAddress?: string | null;
  lltv?: string | number | null;
}): Hex {
  const loan = market.loanAsset?.address || '0x0000000000000000000000000000000000000000';
  const col = market.collateralAsset?.address || '0x0000000000000000000000000000000000000000';
  const oracle = market.oracleAddress || '0x0000000000000000000000000000000000000000';
  const irm = market.irmAddress || '0x0000000000000000000000000000000000000000';
  const lltv = market.lltv ? BigInt(market.lltv) : BigInt(0);

  return encodeAbiParameters(
    parseAbiParameters('address, address, address, address, uint256'),
    [loan as Address, col as Address, oracle as Address, irm as Address, lltv]
  );
}

export function encodeAdapterIdData(adapterAddress: string): Hex {
  return encodeAbiParameters(parseAbiParameters('address'), [adapterAddress as Address]);
}

export function encodeCollateralIdData(collateralAddress: string): Hex {
  return encodeAbiParameters(parseAbiParameters('address'), [collateralAddress as Address]);
}

/** Resolve cap idData bytes for on-chain decrease/increase cap writes. */
export function resolveCapIdData(
  cap: CapInfo,
  risk: V2VaultRiskResponse | null | undefined
): Hex | null {
  if (cap.adapterAddress && !cap.marketKey && !cap.collateralAddress) {
    return encodeAdapterIdData(cap.adapterAddress);
  }

  if (cap.collateralAddress) {
    return encodeCollateralIdData(cap.collateralAddress);
  }

  if (cap.marketKey && risk) {
    for (const adapter of risk.adapters ?? []) {
      for (const m of adapter.markets ?? []) {
        const key = marketKeyFromGraphQL(m.market);
        if (key && key.toLowerCase() === cap.marketKey.toLowerCase()) {
          return encodeMarketIdData(m.market);
        }
      }
    }
  }

  return null;
}
