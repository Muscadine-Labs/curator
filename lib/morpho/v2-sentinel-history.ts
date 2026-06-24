import { gql } from 'graphql-request';
import { getAddress, keccak256, type Address, type Hex } from 'viem';
import type { AdapterInfo, CapInfo } from '@/app/api/vaults/v2/[id]/governance/route';
import { VAULT_V2_GRAPHQL_ADAPTER_LIMIT, VAULT_V2_GRAPHQL_CAPS_LIMIT } from '@/lib/constants';
import { createPublicClient, http } from 'viem';
import { base } from '@/lib/onchain/base-chain';
import { publicClient } from '@/lib/onchain/client';
import { vaultV2Abi } from '@/lib/onchain/abis';
import { morphoGraphQLClient } from '@/lib/morpho/graphql-client';
import { resolveCapIdData } from '@/lib/morpho/v2-id-data';
import { formatRelativeCapWad } from '@/lib/morpho/vault-v2-api';
import { isAdapterCap, isCollateralCap, isMarketCap } from '@/lib/morpho/cap-utils';
import { formatRawTokenAmount, formatAddress } from '@/lib/format/number';
import { mapCap, type GraphCap } from '@/lib/morpho/vault-v2-governance-map';
import { enrichCollateralCapSymbols, enrichMarketCapParams } from '@/lib/morpho/fetch-markets-by-id';
import { logger } from '@/lib/utils/logger';

const V2_DEALLOCATE_QUERY = gql`
  query V2VaultDeallocates($vaultAddress: String!, $chainId: Int!, $first: Int!) {
    vaultV2AllocationTransactions(
      vaultAddress: $vaultAddress
      chainId: $chainId
      first: $first
      orderBy: Timestamp
      orderDirection: Desc
    ) {
      items {
        txHash
        blockNumber
        timestamp
        type
        assets
        adapter
        ids
      }
    }
  }
`;

const SENTINEL_CONTEXT_QUERY = gql`
  query SentinelHistoryContext(
    $address: String!
    $chainId: Int!
    $adapterLimit: Int!
    $capLimit: Int!
  ) {
    vault: vaultV2ByAddress(address: $address, chainId: $chainId) {
      asset {
        symbol
        decimals
      }
      adapters(first: $adapterLimit) {
        items {
          __typename
          address
          ... on MetaMorphoAdapter {
            type
            metaMorpho { address name symbol }
          }
          ... on MorphoMarketV1Adapter {
            type
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
              }
            }
            ... on CollateralCapData {
              collateralAddress
            }
          }
        }
      }
    }
  }
`;

type GraphAdapter = {
  __typename?: string | null;
  address?: string | null;
  type?: string | null;
  metaMorpho?: { address?: string | null; name?: string | null; symbol?: string | null } | null;
};

type SentinelContextResponse = {
  vault?: {
    asset?: { symbol?: string | null; decimals?: number | null } | null;
    adapters?: { items?: Array<GraphAdapter | null> | null } | null;
    caps?: { items?: Array<GraphCap | null> | null } | null;
  } | null;
};

function mapAdapterForLabels(graph: GraphAdapter | null | undefined): AdapterInfo | null {
  if (!graph?.address) return null;
  return {
    address: graph.address,
    type: graph.type ?? 'Unknown',
    assets: null,
    assetsUsd: null,
    factoryAddress: null,
    forceDeallocatePenalty: null,
    metaMorpho:
      graph.__typename === 'MetaMorphoAdapter'
        ? {
            address: graph.metaMorpho?.address ?? null,
            name: graph.metaMorpho?.name ?? null,
            symbol: graph.metaMorpho?.symbol ?? null,
          }
        : null,
  };
}

async function loadSentinelContext(vaultAddress: string, chainId: number) {
  const data = await morphoGraphQLClient.request<SentinelContextResponse>(SENTINEL_CONTEXT_QUERY, {
    address: vaultAddress,
    chainId,
    adapterLimit: VAULT_V2_GRAPHQL_ADAPTER_LIMIT,
    capLimit: VAULT_V2_GRAPHQL_CAPS_LIMIT,
  });

  const adapters =
    data.vault?.adapters?.items
      ?.map(mapAdapterForLabels)
      .filter((a): a is AdapterInfo => a !== null) ?? [];

  let caps =
    data.vault?.caps?.items
      ?.map((cap) => mapCap(cap))
      .filter((cap): cap is CapInfo => cap !== null) ?? [];

  caps = await enrichMarketCapParams(caps, chainId);
  caps = await enrichCollateralCapSymbols(caps, chainId);

  return {
    assetSymbol: data.vault?.asset?.symbol ?? null,
    assetDecimals: data.vault?.asset?.decimals ?? 18,
    adapters,
    caps,
  };
}

export async function loadV2SentinelHistory(
  vaultAddress: string,
  chainId: number,
  first = 100
): Promise<SentinelHistoryResponse> {
  const context = await loadSentinelContext(vaultAddress, chainId);
  return computeV2SentinelHistory({
    vaultAddress,
    chainId,
    caps: context.caps,
    adapters: context.adapters,
    assetSymbol: context.assetSymbol,
    assetDecimals: context.assetDecimals,
    first,
  });
}

type V2DeallocateGraphResponse = {
  vaultV2AllocationTransactions?: {
    items?: Array<{
      txHash?: string | null;
      blockNumber?: number | string | null;
      timestamp?: number | string | null;
      type?: string | null;
      assets?: number | string | null;
      adapter?: string | null;
      ids?: string[] | null;
    } | null> | null;
  } | null;
};

/** ~1.2 days of Base blocks — recent sentinel activity only. */
const LOG_LOOKBACK_BLOCKS = 50_000n;
/** Base public RPC allows up to 10k blocks per eth_getLogs. */
const LOG_CHUNK_SIZE = 10_000n;
const LOG_CHUNK_CONCURRENCY = 2;
const LOG_CHUNK_DELAY_MS = 300;

const logsPublicClient = createPublicClient({
  chain: base,
  transport: http('https://mainnet.base.org'),
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type SentinelActivityEvent = {
  hash: string;
  timestamp: number;
  blockNumber: number | null;
  type: 'Deallocate' | 'DecreaseAbsoluteCap' | 'DecreaseRelativeCap';
  label: string | null;
  detail: string | null;
  adapterAddress: string | null;
  capId: string | null;
};

export type SentinelActivityGroup = {
  hash: string;
  timestamp: number;
  blockNumber: number | null;
  events: SentinelActivityEvent[];
};

export type SentinelHistoryResponse = {
  vaultAddress: string;
  groups: SentinelActivityGroup[];
};

async function fetchBlockTimestamps(blockNumbers: number[]): Promise<Map<number, number>> {
  const unique = [...new Set(blockNumbers.filter((n) => Number.isFinite(n)))];
  const entries = await Promise.all(
    unique.map(async (blockNumber) => {
      const block = await publicClient.getBlock({ blockNumber: BigInt(blockNumber) });
      return [blockNumber, Number(block.timestamp)] as const;
    })
  );
  return new Map(entries);
}

async function getVaultLogsChunked(
  vaultAddress: Address,
  eventName: 'DecreaseAbsoluteCap' | 'DecreaseRelativeCap'
) {
  const latest = await logsPublicClient.getBlockNumber();
  const fromBlock = latest > LOG_LOOKBACK_BLOCKS ? latest - LOG_LOOKBACK_BLOCKS : 0n;
  const ranges: Array<{ fromBlock: bigint; toBlock: bigint }> = [];

  for (let start = fromBlock; start <= latest; start += LOG_CHUNK_SIZE) {
    const end = start + LOG_CHUNK_SIZE - 1n > latest ? latest : start + LOG_CHUNK_SIZE - 1n;
    ranges.push({ fromBlock: start, toBlock: end });
  }

  const logs = [];
  for (let i = 0; i < ranges.length; i += LOG_CHUNK_CONCURRENCY) {
    if (i > 0) {
      await sleep(LOG_CHUNK_DELAY_MS);
    }
    const batch = ranges.slice(i, i + LOG_CHUNK_CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async ({ fromBlock, toBlock }) => {
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            return await logsPublicClient.getContractEvents({
              address: vaultAddress,
              abi: vaultV2Abi,
              eventName,
              fromBlock,
              toBlock,
            });
          } catch (error) {
            if (attempt === 2) {
              logger.warn('Sentinel history log chunk failed after retries', {
                vaultAddress,
                eventName,
                fromBlock: fromBlock.toString(),
                toBlock: toBlock.toString(),
                error: error instanceof Error ? error : new Error(String(error)),
              });
              return [];
            }
            await sleep(400 * (attempt + 1));
          }
        }
        return [];
      })
    );
    for (const chunk of batchResults) {
      logs.push(...chunk);
    }
  }

  return logs;
}

function serverCapLabel(cap: CapInfo, adapterLabels: Map<string, string>): string {
  if (isAdapterCap(cap) && cap.adapterAddress) {
    return adapterLabels.get(cap.adapterAddress.toLowerCase()) ?? 'Adapter';
  }
  if (isCollateralCap(cap)) {
    if (cap.collateralSymbol) return cap.collateralSymbol;
    if (cap.collateralAddress) return formatAddress(cap.collateralAddress);
    return 'Collateral cap';
  }
  if (isMarketCap(cap)) {
    const loan = cap.marketParams?.loanAsset?.symbol;
    const collateral = cap.marketParams?.collateralAsset?.symbol;
    if (loan || collateral) return `${collateral ?? '?'} / ${loan ?? '?'}`;
    if (cap.marketKey) return formatAddress(cap.marketKey, 6, 4);
  }
  return 'Cap';
}

function buildAdapterLabelMapServer(adapters: AdapterInfo[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const a of adapters) {
    const label =
      a.metaMorpho?.name ??
      a.metaMorpho?.symbol ??
      (a.type === 'MetaMorpho' || a.type === 'MetaMorphoAdapter'
        ? 'MetaMorpho Adapter'
        : 'Variable Rate Market Adapter');
    map.set(a.address.toLowerCase(), label);
  }
  return map;
}

function formatCapRelative(relativeCap: string): string {
  return formatRelativeCapWad(relativeCap);
}

function buildCapIdLabelMap(caps: CapInfo[], adapters: AdapterInfo[]): Map<string, string> {
  const adapterLabels = buildAdapterLabelMapServer(adapters);
  const map = new Map<string, string>();
  for (const cap of caps) {
    const idData = resolveCapIdData(cap, null);
    if (!idData) continue;
    const id = keccak256(idData).toLowerCase();
    map.set(id, serverCapLabel(cap, adapterLabels));
  }
  return map;
}

function capLabelForId(capId: Hex, capLabels: Map<string, string>): string {
  return capLabels.get(capId.toLowerCase()) ?? `Cap ${formatAddress(capId, 6, 4)}`;
}

export async function computeV2SentinelHistory(input: {
  vaultAddress: string;
  chainId: number;
  caps: CapInfo[];
  adapters: AdapterInfo[];
  assetSymbol: string | null;
  assetDecimals: number;
  first?: number;
}): Promise<SentinelHistoryResponse> {
  const vaultAddress = getAddress(input.vaultAddress) as Address;
  const capLabels = buildCapIdLabelMap(input.caps, input.adapters);
  const first = input.first ?? 200;

  const [graphData, absoluteLogs, relativeLogs] = await Promise.all([
    morphoGraphQLClient.request<V2DeallocateGraphResponse>(V2_DEALLOCATE_QUERY, {
      vaultAddress,
      chainId: input.chainId,
      first,
    }),
    getVaultLogsChunked(vaultAddress, 'DecreaseAbsoluteCap'),
    getVaultLogsChunked(vaultAddress, 'DecreaseRelativeCap'),
  ]);

  const blockNumbers: number[] = [];
  const rawEvents: Array<Omit<SentinelActivityEvent, 'timestamp'> & { timestamp: number | null }> = [];

  for (const tx of graphData.vaultV2AllocationTransactions?.items ?? []) {
    if (!tx?.txHash || tx.type !== 'Deallocate') continue;
    const blockNumber = tx.blockNumber != null ? Number(tx.blockNumber) : null;
    if (blockNumber != null) blockNumbers.push(blockNumber);
    const capId = tx.ids?.[0] ?? null;
    rawEvents.push({
      hash: String(tx.txHash),
      timestamp: tx.timestamp != null ? Number(tx.timestamp) : null,
      blockNumber,
      type: 'Deallocate',
      label: capId ? capLabelForId(capId as Hex, capLabels) : null,
      detail:
        tx.assets != null
          ? `${formatRawTokenAmount(BigInt(String(tx.assets)), input.assetDecimals, input.assetDecimals >= 8 ? 4 : 2)} ${input.assetSymbol ?? ''}`.trim()
          : null,
      adapterAddress: tx.adapter ?? null,
      capId,
    });
  }

  for (const log of absoluteLogs) {
    const blockNumber = Number(log.blockNumber);
    blockNumbers.push(blockNumber);
    const args = log.args as { id: Hex; newAbsoluteCap: bigint };
    const capId = args.id;
    rawEvents.push({
      hash: log.transactionHash,
      timestamp: null,
      blockNumber,
      type: 'DecreaseAbsoluteCap',
      label: capLabelForId(capId, capLabels),
      detail: formatRawTokenAmount(
        args.newAbsoluteCap,
        input.assetDecimals,
        input.assetDecimals >= 8 ? 4 : 2
      ),
      adapterAddress: null,
      capId,
    });
  }

  for (const log of relativeLogs) {
    const blockNumber = Number(log.blockNumber);
    blockNumbers.push(blockNumber);
    const args = log.args as { id: Hex; newRelativeCap: bigint };
    const capId = args.id;
    rawEvents.push({
      hash: log.transactionHash,
      timestamp: null,
      blockNumber,
      type: 'DecreaseRelativeCap',
      label: capLabelForId(capId, capLabels),
      detail: formatCapRelative(String(args.newRelativeCap)),
      adapterAddress: null,
      capId,
    });
  }

  const blockTimes = await fetchBlockTimestamps(blockNumbers);

  const events: SentinelActivityEvent[] = rawEvents.map((ev) => ({
    ...ev,
    timestamp:
      ev.timestamp ??
      (ev.blockNumber != null ? blockTimes.get(ev.blockNumber) ?? 0 : 0),
  }));

  const groupMap = new Map<string, SentinelActivityGroup>();
  for (const ev of events) {
    const existing = groupMap.get(ev.hash);
    if (existing) {
      existing.events.push(ev);
      if (ev.timestamp > existing.timestamp) existing.timestamp = ev.timestamp;
    } else {
      groupMap.set(ev.hash, {
        hash: ev.hash,
        timestamp: ev.timestamp,
        blockNumber: ev.blockNumber,
        events: [ev],
      });
    }
  }

  const groups = Array.from(groupMap.values())
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, first);

  return { vaultAddress, groups };
}
