import { getAddress, type Address } from 'viem';
import { getChainAddresses } from '@morpho-org/morpho-ts';
import { CURATOR_MARKET_NETWORKS } from '@/lib/constants';

export type CreateMarketDeployment = {
  chainId: number;
  name: string;
  morpho: Address;
  adaptiveCurveIrm: Address;
  chainlinkOracleFactory: Address;
};

function addr(value: string | undefined, label: string, chainId: number): Address {
  if (!value) {
    throw new Error(`Missing ${label} for chain ${chainId}`);
  }
  return getAddress(value) as Address;
}

function buildDeployment(chainId: number, name: string): CreateMarketDeployment {
  const a = getChainAddresses(chainId);
  return {
    chainId,
    name,
    morpho: addr(a.morpho, 'morpho', chainId),
    adaptiveCurveIrm: addr(a.adaptiveCurveIrm, 'adaptiveCurveIrm', chainId),
    chainlinkOracleFactory: addr(
      a.chainlinkOracleFactory,
      'chainlinkOracleFactory',
      chainId
    ),
  };
}

/** Lazy cache — missing Morpho addresses only fail when that chain is requested. */
const cache = new Map<number, CreateMarketDeployment>();

/** Morpho Blue createMarket deployments for curator networks. */
export function getCreateMarketDeployment(chainId: number): CreateMarketDeployment {
  const cached = cache.get(chainId);
  if (cached) return cached;

  const name =
    CURATOR_MARKET_NETWORKS.find((n) => n.chainId === chainId)?.name ?? null;
  if (!name) {
    throw new Error(`createMarket is not configured for chain ${chainId}`);
  }

  const dep = buildDeployment(chainId, name);
  cache.set(chainId, dep);
  return dep;
}
