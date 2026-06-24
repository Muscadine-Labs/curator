import { getAddress, keccak256, type Address, type Hex } from 'viem';
import type { CapInfo } from '@/app/api/vaults/v2/[id]/governance/route';
import type {
  V2AdapterRiskData,
  V2MarketRiskData,
  V2VaultRiskResponse,
} from '@/app/api/vaults/v2/[id]/risk/route';
import { publicClient } from '@/lib/onchain/client';
import { vaultV2Abi } from '@/lib/onchain/abis';
import { resolveCapIdData, encodeAdapterCapIdData, encodeMarketCapIdData } from '@/lib/morpho/v2-id-data';
import type { MarketRiskGrade } from '@/lib/morpho/compute-v1-market-risk';
import { logger } from '@/lib/utils/logger';

type CapReadContract = {
  address: Address;
  abi: typeof vaultV2Abi;
  functionName: 'absoluteCap' | 'relativeCap' | 'allocation';
  args: readonly [Hex];
};

function capReadContracts(vault: Address, id: Hex): CapReadContract[] {
  return [
    { address: vault, abi: vaultV2Abi, functionName: 'absoluteCap', args: [id] },
    { address: vault, abi: vaultV2Abi, functionName: 'relativeCap', args: [id] },
    { address: vault, abi: vaultV2Abi, functionName: 'allocation', args: [id] },
  ];
}

/** Live absoluteCap, relativeCap, and allocation keyed by keccak256(idData). */
export async function fetchOnChainCapStateByCap(
  vaultAddress: string,
  caps: CapInfo[]
): Promise<{
  absoluteCap: Map<string, bigint>;
  relativeCap: Map<string, bigint>;
  allocation: Map<string, bigint>;
}> {
  const vault = getAddress(vaultAddress);
  const capIndices: number[] = [];
  const idByCapIndex = new Map<number, string>();
  const contracts: CapReadContract[] = [];

  for (let i = 0; i < caps.length; i++) {
    const idData = resolveCapIdData(caps[i], null);
    if (!idData) continue;
    const id = keccak256(idData).toLowerCase();
    capIndices.push(i);
    idByCapIndex.set(i, id);
    contracts.push(...capReadContracts(vault, id as Hex));
  }

  const absoluteCap = new Map<string, bigint>();
  const relativeCap = new Map<string, bigint>();
  const allocation = new Map<string, bigint>();

  if (contracts.length === 0) {
    return { absoluteCap, relativeCap, allocation };
  }

  const results = await publicClient.multicall({ contracts, allowFailure: true });

  for (let j = 0; j < capIndices.length; j++) {
    const id = idByCapIndex.get(capIndices[j]!)!;
    const base = j * 3;
    const abs = results[base];
    const rel = results[base + 1];
    const alloc = results[base + 2];
    if (abs?.status === 'success') absoluteCap.set(id, abs.result);
    if (rel?.status === 'success') relativeCap.set(id, rel.result);
    if (alloc?.status === 'success') allocation.set(id, alloc.result);
  }

  return { absoluteCap, relativeCap, allocation };
}

export async function overlayV2OnChainCaps(
  vaultAddress: string,
  caps: CapInfo[]
): Promise<CapInfo[]> {
  const capIndices: number[] = [];
  const idByCapIndex = new Map<number, string>();

  for (let i = 0; i < caps.length; i++) {
    const idData = resolveCapIdData(caps[i], null);
    if (!idData) continue;
    capIndices.push(i);
    idByCapIndex.set(i, keccak256(idData).toLowerCase());
  }

  if (capIndices.length === 0) return caps;

  const onChain = await fetchOnChainCapStateByCap(vaultAddress, caps);
  const updated = caps.map((cap) => ({ ...cap }));

  for (const capIdx of capIndices) {
    const id = idByCapIndex.get(capIdx)!;
    const abs = onChain.absoluteCap.get(id);
    const rel = onChain.relativeCap.get(id);
    const alloc = onChain.allocation.get(id);
    if (abs != null) updated[capIdx]!.absoluteCap = abs.toString();
    if (rel != null) updated[capIdx]!.relativeCap = rel.toString();
    if (alloc != null) updated[capIdx]!.allocation = alloc.toString();
  }

  return updated;
}

function allocationUsdFromRaw(raw: bigint, totalAssetsRaw: bigint, totalAssetsUsd: number | null): number {
  if (raw <= 0n || totalAssetsRaw <= 0n || totalAssetsUsd == null || totalAssetsUsd <= 0) return 0;
  return (Number(raw) / Number(totalAssetsRaw)) * totalAssetsUsd;
}

function adapterAllocationId(adapter: V2AdapterRiskData): string {
  return keccak256(encodeAdapterCapIdData(adapter.adapterAddress)).toLowerCase();
}

function marketAllocationId(adapterAddress: string, market: V2MarketRiskData['market']): string {
  return keccak256(encodeMarketCapIdData(adapterAddress, market)).toLowerCase();
}

async function fetchOnChainAllocationsForIds(
  vaultAddress: string,
  idHashes: Hex[]
): Promise<Map<string, bigint>> {
  if (idHashes.length === 0) return new Map();

  const vault = getAddress(vaultAddress);
  const contracts = idHashes.map((id) => ({
    address: vault,
    abi: vaultV2Abi,
    functionName: 'allocation' as const,
    args: [id] as const,
  }));

  const results = await publicClient.multicall({ contracts, allowFailure: true });
  const map = new Map<string, bigint>();

  idHashes.forEach((id, index) => {
    const result = results[index];
    if (result?.status === 'success') {
      map.set(id.toLowerCase(), result.result);
    }
  });

  return map;
}

function collectStrategyAllocationIds(risk: V2VaultRiskResponse): Hex[] {
  const seen = new Set<string>();
  const ids: Hex[] = [];

  const pushId = (id: string) => {
    const key = id.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    ids.push(key as Hex);
  };

  for (const adapter of risk.adapters ?? []) {
    if (adapter.adapterType === 'MetaMorphoAdapter') {
      pushId(adapterAllocationId(adapter));
      continue;
    }
    for (const m of adapter.markets ?? []) {
      if (!m.market) continue;
      pushId(marketAllocationId(adapter.adapterAddress, m.market));
    }
  }

  return ids;
}

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

function recomputeVaultRiskScore(adapters: V2AdapterRiskData[]): {
  vaultRiskScore: number;
  vaultRiskGrade: MarketRiskGrade;
  totalAdapterAssetsUsd: number;
} {
  const totalAdapterAssetsUsd = adapters.reduce((sum, a) => sum + (a.allocationUsd ?? 0), 0);
  const vaultWeightedSum = adapters.reduce((sum, adapter) => {
    if (adapter.allocationUsd > 0) {
      return sum + adapter.riskScore * adapter.allocationUsd;
    }
    return sum;
  }, 0);
  const vaultRiskScore =
    totalAdapterAssetsUsd > 0 ? vaultWeightedSum / totalAdapterAssetsUsd : 0;
  return {
    totalAdapterAssetsUsd,
    vaultRiskScore,
    vaultRiskGrade: getGradeFromScore(vaultRiskScore),
  };
}

/**
 * Overlay live vault allocation amounts on risk API data.
 * Market stats (util, APY, liquidity) stay from Morpho GraphQL.
 */
export async function overlayV2OnChainAllocations(
  vaultAddress: string,
  risk: V2VaultRiskResponse,
  totalAssetsUsd: number | null
): Promise<V2VaultRiskResponse> {
  const vault = getAddress(vaultAddress);
  const idHashes = collectStrategyAllocationIds(risk);

  const [allocationById, totalAssetsRaw] = await Promise.all([
    fetchOnChainAllocationsForIds(vaultAddress, idHashes),
    publicClient.readContract({
      address: vault,
      abi: vaultV2Abi,
      functionName: 'totalAssets',
    }) as Promise<bigint>,
  ]);

  let strategySum = 0n;

  const adapters = (risk.adapters ?? []).map((adapter): V2AdapterRiskData => {
    if (adapter.adapterType === 'MetaMorphoAdapter') {
      const raw = allocationById.get(adapterAllocationId(adapter)) ?? 0n;
      strategySum += raw;
      return {
        ...adapter,
        allocationAssets: raw > 0n ? raw.toString() : null,
        allocationUsd: allocationUsdFromRaw(raw, totalAssetsRaw, totalAssetsUsd),
      };
    }

    let adapterSum = 0n;
    const markets = (adapter.markets ?? []).map((m): V2MarketRiskData => {
      const raw = m.market
        ? allocationById.get(marketAllocationId(adapter.adapterAddress, m.market)) ?? 0n
        : 0n;
      adapterSum += raw;
      return {
        ...m,
        allocationAssets: raw > 0n ? raw.toString() : null,
        allocationUsd: allocationUsdFromRaw(raw, totalAssetsRaw, totalAssetsUsd),
      };
    });
    strategySum += adapterSum;

    return {
      ...adapter,
      allocationAssets: adapterSum > 0n ? adapterSum.toString() : null,
      allocationUsd: allocationUsdFromRaw(adapterSum, totalAssetsRaw, totalAssetsUsd),
      markets,
    };
  });

  const computedResidual =
    totalAssetsRaw > strategySum ? totalAssetsRaw - strategySum : 0n;

  // Morpho GraphQL idleAssets is deployable vault cash. totalAssets − Σ allocation(id)
  // can be higher (interest accrual in totalAssets not yet in per-id allocation counters).
  let graphQlIdle: bigint | null = null;
  if (risk.idleAssets != null) {
    try {
      graphQlIdle = BigInt(risk.idleAssets);
    } catch {
      graphQlIdle = null;
    }
  }

  const idleRaw = graphQlIdle ?? computedResidual;

  if (
    graphQlIdle != null &&
    computedResidual > graphQlIdle &&
    computedResidual - graphQlIdle > 1000n
  ) {
    logger.debug('Allocation accrual gap (not deployable idle)', {
      vaultAddress,
      computedResidual: computedResidual.toString(),
      idleAssets: graphQlIdle.toString(),
    });
  }

  const idleAssetsUsd = allocationUsdFromRaw(idleRaw, totalAssetsRaw, totalAssetsUsd);
  const headline = recomputeVaultRiskScore(adapters);

  return {
    ...risk,
    adapters,
    totalAssets: totalAssetsRaw.toString(),
    idleAssets: idleRaw.toString(),
    idleAssetsUsd,
    ...headline,
  };
}
