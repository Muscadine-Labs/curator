import { erc20Abi, getAddress, keccak256, parseAbi, type Address, type Hex } from 'viem';
import type { CapInfo } from '@/app/api/vaults/[id]/governance/route';
import type {
  V2AdapterRiskData,
  V2MarketRiskData,
  V2VaultRiskResponse,
} from '@/app/api/vaults/[id]/risk/route';
import { publicClient } from '@/lib/onchain/client';
import { vaultV2Abi } from '@/lib/onchain/abis';
import {
  resolveCapIdData,
  encodeMarketCapIdData,
  encodeAdapterCapIdData,
  encodeMarketParamsData,
} from '@/lib/morpho/v2-id-data';
import {
  getMarketRiskGrade,
  type MarketRiskGrade,
} from '@/lib/morpho/compute-blue-market-risk';
import { logger } from '@/lib/utils/logger';
import { isMorphoVaultV2Adapter } from '@/lib/morpho/vault-v2-adapter';

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

function parseAllocationBigInt(value: string | null | undefined): bigint | null {
  if (value == null) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function resolveAllocationRaw(
  vaultAddress: string,
  idKey: string,
  onChainById: Map<string, bigint>,
  graphQlAssets: string | null | undefined,
  context: string,
  liveById?: Map<string, bigint>
): { display: bigint; booked: bigint; live: bigint | null } {
  const onChain = onChainById.get(idKey);
  const graphQl = parseAllocationBigInt(graphQlAssets);
  const live = liveById?.get(idKey);

  // The adapter's own live position (incl. accrued interest) beats both the
  // booked counter and Morpho's indexer, which lags right after a rebalance —
  // max(GraphQL, booked) would keep showing the pre-deallocation amount, and
  // rebalance inputs resolve as booked + (input − display).
  if (live != null) {
    // `live` is only exposed for full withdrawals when booked is on-chain too;
    // a GraphQL booked amount would make the interest estimate meaningless.
    return { display: live, booked: onChain ?? graphQl ?? live, live: onChain != null ? live : null };
  }

  if (onChain != null && graphQl != null) {
    // Booked allocation(id) updates on rebalance; Morpho position supply includes interest.
    const display = graphQl > onChain ? graphQl : onChain;
    return { display, booked: onChain, live: null };
  }

  if (onChain != null) {
    return { display: onChain, booked: onChain, live: null };
  }

  if (graphQl != null) {
    if (!onChainById.has(idKey)) {
      logger.warn('On-chain allocation read unavailable; using GraphQL allocation', {
        vaultAddress,
        id: idKey,
        context,
      });
    }
    return { display: graphQl, booked: graphQl, live: null };
  }

  return { display: 0n, booked: 0n, live: null };
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

const adapterLiveAbi = parseAbi([
  'function expectedSupplyAssets(bytes32 marketId) view returns (uint256)',
  'function realAssets() view returns (uint256)',
]);

/**
 * Live per-row positions straight from the adapters: Blue market adapters'
 * `expectedSupplyAssets(marketId)` and a fee wrapper's Vault V2 adapter
 * `realAssets()`. Keyed like `allocation(id)`; rows whose read fails are
 * absent and fall back to booked / GraphQL amounts.
 */
async function fetchLiveAdapterPositions(risk: V2VaultRiskResponse): Promise<Map<string, bigint>> {
  const keys: string[] = [];
  const contracts: Array<
    | {
        address: Address;
        abi: typeof adapterLiveAbi;
        functionName: 'expectedSupplyAssets';
        args: readonly [Hex];
      }
    | { address: Address; abi: typeof adapterLiveAbi; functionName: 'realAssets' }
  > = [];

  for (const adapter of risk.adapters ?? []) {
    const address = getAddress(adapter.adapterAddress);
    if (isMorphoVaultV2Adapter(adapter) && (adapter.markets ?? []).length === 0) {
      keys.push(adapterAllocationId(adapter.adapterAddress));
      contracts.push({ address, abi: adapterLiveAbi, functionName: 'realAssets' });
      continue;
    }
    for (const m of adapter.markets ?? []) {
      if (!m.market) continue;
      let marketId: Hex;
      try {
        marketId = keccak256(encodeMarketParamsData(m.market));
      } catch {
        continue;
      }
      keys.push(marketAllocationId(adapter.adapterAddress, m.market));
      contracts.push({
        address,
        abi: adapterLiveAbi,
        functionName: 'expectedSupplyAssets',
        args: [marketId],
      });
    }
  }

  const live = new Map<string, bigint>();
  if (contracts.length === 0) return live;
  const results = await publicClient.multicall({ contracts, allowFailure: true });
  results.forEach((result, i) => {
    if (result.status === 'success') live.set(keys[i]!, result.result as bigint);
  });
  return live;
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
    if (isMorphoVaultV2Adapter(adapter)) {
      pushId(adapterAllocationId(adapter.adapterAddress));
    }
    for (const m of adapter.markets ?? []) {
      if (!m.market) continue;
      pushId(marketAllocationId(adapter.adapterAddress, m.market));
    }
  }

  return ids;
}

/** `asset().balanceOf(vault)` — the vault's idle cash; null when the read fails. */
async function readVaultIdleCash(vault: Address): Promise<bigint | null> {
  try {
    const asset = (await publicClient.readContract({
      address: vault,
      abi: vaultV2Abi,
      functionName: 'asset',
    })) as Address;
    return await publicClient.readContract({
      address: asset,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [vault],
    });
  } catch (error) {
    logger.warn('Vault idle cash read failed; using GraphQL idle', {
      vaultAddress: vault,
      error: error instanceof Error ? error : new Error(String(error)),
    });
    return null;
  }
}

function adapterAllocationId(adapterAddress: string): string {
  return keccak256(encodeAdapterCapIdData(adapterAddress)).toLowerCase();
}

function recomputeVaultRiskScore(adapters: V2AdapterRiskData[]): {
  vaultRiskScore: number;
  vaultRiskGrade: MarketRiskGrade;
  totalAdapterAssetsUsd: number;
} {
  const totalAdapterAssetsUsd = adapters.reduce((sum, a) => sum + (a.allocationUsd ?? 0), 0);
  const scored = adapters.filter((a) => a.adapterType === 'MorphoMarketV1Adapter');
  const scoreWeightUsd = scored.reduce((sum, a) => sum + (a.allocationUsd ?? 0), 0);
  const vaultWeightedSum = scored.reduce((sum, adapter) => {
    if (adapter.allocationUsd > 0) {
      return sum + adapter.riskScore * adapter.allocationUsd;
    }
    return sum;
  }, 0);
  const vaultRiskScore =
    scoreWeightUsd > 0 ? vaultWeightedSum / scoreWeightUsd : 0;
  return {
    totalAdapterAssetsUsd,
    vaultRiskScore,
    vaultRiskGrade: getMarketRiskGrade(vaultRiskScore),
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

  const [allocationById, totalAssetsRaw, liveById, idleCash] = await Promise.all([
    fetchOnChainAllocationsForIds(vaultAddress, idHashes),
    publicClient.readContract({
      address: vault,
      abi: vaultV2Abi,
      functionName: 'totalAssets',
    }) as Promise<bigint>,
    fetchLiveAdapterPositions(risk).catch((error) => {
      logger.warn('Live adapter position reads failed; using booked / GraphQL amounts', {
        vaultAddress,
        error: error instanceof Error ? error : new Error(String(error)),
      });
      return new Map<string, bigint>();
    }),
    readVaultIdleCash(vault),
  ]);

  let strategySum = 0n;

  const adapters = (risk.adapters ?? []).map((adapter): V2AdapterRiskData => {
    if (isMorphoVaultV2Adapter(adapter) && (adapter.markets ?? []).length === 0) {
      const idKey = adapterAllocationId(adapter.adapterAddress);
      const { display, booked, live } = resolveAllocationRaw(
        vaultAddress,
        idKey,
        allocationById,
        adapter.allocationAssets,
        `adapter ${adapter.adapterAddress}`,
        liveById
      );
      strategySum += display;
      return {
        ...adapter,
        allocationAssets: display > 0n ? display.toString() : null,
        bookedAllocationAssets: booked.toString(),
        liveAllocationAssets: live != null ? live.toString() : null,
        allocationUsd: allocationUsdFromRaw(display, totalAssetsRaw, totalAssetsUsd),
        markets: [],
      };
    }

    let adapterSum = 0n;
    const markets = (adapter.markets ?? []).map((m): V2MarketRiskData => {
      const idKey = m.market
        ? marketAllocationId(adapter.adapterAddress, m.market)
        : '';
      const { display, booked, live } = m.market
        ? resolveAllocationRaw(
            vaultAddress,
            idKey,
            allocationById,
            m.allocationAssets,
            `market ${idKey}`,
            liveById
          )
        : { display: 0n, booked: 0n, live: null };
      adapterSum += display;
      return {
        ...m,
        allocationAssets: display > 0n ? display.toString() : null,
        bookedAllocationAssets: booked.toString(),
        liveAllocationAssets: live != null ? live.toString() : null,
        allocationUsd: allocationUsdFromRaw(display, totalAssetsRaw, totalAssetsUsd),
      };
    });
    strategySum += adapterSum;

    return {
      ...adapter,
      allocationAssets: adapterSum > 0n ? adapterSum.toString() : null,
      bookedAllocationAssets: null,
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

  // The vault's own asset balance is the deployable idle cash — exact and live.
  // Fallback: GraphQL idleAssets lags after rebalances; on-chain totalAssets − Σ
  // allocation is fresher, but accrual can inflate it, so GraphQL idle is the ceiling.
  const idleRaw =
    idleCash != null
      ? idleCash
      : graphQlIdle != null
        ? computedResidual < graphQlIdle
          ? computedResidual
          : graphQlIdle
        : computedResidual;

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
