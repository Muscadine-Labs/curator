import { NextRequest, NextResponse } from 'next/server';
import { parseBoundedIntParam } from '@/lib/api/query-params';
import { gql } from 'graphql-request';
import { getAddress, isAddress, type Address, type Hex } from 'viem';
import {
  getAllVaultAddresses,
  getConfiguredVaultDisplayName,
  getVaultAssetSymbol,
} from '@/lib/config/vaults';
import { BASE_CHAIN_ID } from '@/lib/constants';
import { labelForActor, type BotActorKind } from '@/lib/format/address-label';
import {
  decodeTransactionVaultCalls,
  type DecodedMarketParams,
  type DecodedVaultCallSummary,
} from '@/lib/bots/decode-vault-calls';
import { formatMarketNameWithLltv } from '@/lib/morpho/market-label';
import { formatRelativeCapWad } from '@/lib/morpho/vault-v2-api';
import { formatRawTokenAmount } from '@/lib/format/number';
import { morphoGraphQLClient } from '@/lib/morpho/graphql-client';
import { batchVaultV2ByAddress, batchVaultV2AllocationTransactions } from '@/lib/morpho/batch-vault-graphql';
import { publicClient } from '@/lib/onchain/client';
import { handleApiError } from '@/lib/utils/error-handler';
import {
  createRateLimitMiddleware,
  RATE_LIMIT_REQUESTS_PER_MINUTE,
  MINUTE_MS,
} from '@/lib/utils/rate-limit';
import { mergeApiCacheHeaders, API_CACHE_MAX_AGE_MS } from '@/lib/api/response-cache';
import { withServerResponseCache } from '@/lib/api/server-response-cache';
import { logger } from '@/lib/utils/logger';
import { getSafeByRole } from '@/lib/safe/config';
import { decodeMultiSend, isKnownMultiSend } from '@/lib/safe/multisend';
import {
  fetchExecutedMultisigTransactions,
  isTransactionServiceConfigured,
} from '@/lib/safe/transaction-service';
import { fetchRebaterActivity, type RebaterActivityItem, type RebaterWatcher } from '@/lib/bots/rebater-activity';
import { unauthorizedUnlessAdmin } from '@/lib/auth/require-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export type BotActivityChange = {
  type: string;
  change: string | null;
  assets: string | null;
  allocationId: string | null;
  adapterAddress: string | null;
  /** Human market label when type is LiquidityAdapter. */
  marketLabel?: string | null;
  marketId?: string | null;
};

export type BotActivityItem = {
  hash: string;
  timestamp: number | null;
  blockNumber: number | null;
  from: string;
  /** Display label for signer — "Allocator Safe", "Sentinel Safe", etc. */
  actorLabel: string;
  actorKind: BotActorKind;
  vaultAddress: string;
  vaultName: string;
  assetSymbol: string;
  assetDecimals: number;
  panel: 'allocator' | 'sentinel';
  changes: BotActivityChange[];
  liquidityMarketLabel: string | null;
  liquidityMarketId: string | null;
  apyBefore: number | null;
  apyAfter: number | null;
  apyDeltaPp: number | null;
  riskNote: string;
};

export type { RebaterActivityItem, RebaterWatcher } from '@/lib/bots/rebater-activity';

export type BotWatcher = {
  address: string;
  label: string;
  kind: BotActorKind;
};

export type BotVaultOption = {
  address: string;
  name: string;
  assetSymbol: string;
};

export type BotActivityResponse = {
  vaults: BotVaultOption[];
  allocators: BotWatcher[];
  sentinels: BotWatcher[];
  allocatorItems: BotActivityItem[];
  sentinelItems: BotActivityItem[];
  rebaterWatchers: RebaterWatcher[];
  rebaterItems: RebaterActivityItem[];
  rebaterTruncated: boolean;
  rebaterError: string | null;
};

const APY_QUERY = gql`
  query BotVaultApy($address: String!, $chainId: Int!, $options: TimeseriesOptions) {
    vaultV2ByAddress(address: $address, chainId: $chainId) {
      historicalState {
        avgNetApy(options: $options) {
          x
          y
        }
      }
    }
  }
`;

const MARKET_BY_ID_QUERY = gql`
  query BotMarketById($marketId: String!, $chainId: Int!) {
    marketById(marketId: $marketId, chainId: $chainId) {
      loanAsset {
        symbol
      }
      collateralAsset {
        symbol
      }
      lltv
    }
  }
`;

const MARKETS_BY_ASSETS_QUERY = gql`
  query BotMarketsByAssets(
    $chainId: Int!
    $loan: [String!]!
    $collateral: [String!]!
  ) {
    markets(
      first: 25
      where: {
        chainId_in: [$chainId]
        loanAssetAddress_in: $loan
        collateralAssetAddress_in: $collateral
      }
    ) {
      items {
        marketId
        lltv
        loanAsset {
          symbol
        }
        collateralAsset {
          symbol
        }
      }
    }
  }
`;

type MarketGraph = {
  marketById?: {
    loanAsset?: { symbol?: string | null } | null;
    collateralAsset?: { symbol?: string | null } | null;
    lltv?: string | number | null;
  } | null;
};

type MarketsByAssetsGraph = {
  markets?: {
    items?: Array<{
      marketId?: string | null;
      lltv?: string | number | null;
      loanAsset?: { symbol?: string | null } | null;
      collateralAsset?: { symbol?: string | null } | null;
    } | null> | null;
  } | null;
};

type ApyGraph = {
  vaultV2ByAddress?: {
    historicalState?: {
      avgNetApy?: Array<{ x?: number | null; y?: number | null } | null> | null;
    } | null;
  } | null;
};

function assetDecimalsForSymbol(symbol: string): number {
  const s = symbol.toUpperCase();
  if (s === 'USDC' || s === 'USDT') return 6;
  if (s === 'CBBTC' || s === 'WBTC') return 8;
  return 18;
}

function riskNoteFromChanges(changes: BotActivityChange[]): string {
  const hasLiquidity = changes.some((c) =>
    c.type.toLowerCase().includes('liquidity')
  );
  const hasCapDecrease = changes.some((c) =>
    c.type.toLowerCase().includes('decrease') && c.type.toLowerCase().includes('cap')
  );
  const hasRevokeAllocator = changes.some((c) =>
    c.type.toLowerCase() === 'revokeallocator'
  );
  const hasRevokePending = changes.some((c) =>
    c.type.toLowerCase() === 'revokepending'
  );

  if (hasCapDecrease && !changes.some((c) => c.type.toLowerCase().includes('dealloc'))) {
    return hasRevokeAllocator
      ? 'Risk ↓ — cap lowered and allocator access revoked.'
      : 'Risk ↓ — allocation cap lowered (sentinel guardrail).';
  }
  if (hasRevokeAllocator && !changes.some((c) => c.type.toLowerCase().includes('dealloc'))) {
    return 'Risk ↓ — allocator access revoked.';
  }
  if (hasRevokePending && !changes.some((c) => c.type.toLowerCase().includes('dealloc'))) {
    return 'Risk ↓ — pending timelock action revoked.';
  }

  let alloc = 0n;
  let dealloc = 0n;
  for (const c of changes) {
    if (c.type.toLowerCase().includes('liquidity')) continue;
    if (
      c.type.toLowerCase().includes('cap') ||
      c.type.toLowerCase() === 'revokeallocator' ||
      c.type.toLowerCase() === 'grantallocator' ||
      c.type.toLowerCase() === 'revokepending'
    ) {
      continue;
    }
    const raw = c.change ?? c.assets;
    if (raw == null) continue;
    let n = 0n;
    try {
      n = BigInt(raw);
    } catch {
      continue;
    }
    const t = c.type.toLowerCase();
    if (t.includes('dealloc') || t.includes('withdraw')) {
      dealloc += n < 0n ? -n : n;
    } else if (t.includes('alloc') || t.includes('supply')) {
      alloc += n < 0n ? -n : n;
    } else if (n < 0n) {
      dealloc += -n;
    } else {
      alloc += n;
    }
  }

  if (hasLiquidity && alloc === 0n && dealloc === 0n) {
    return 'Liquidity adapter market changed (exit path).';
  }
  if (alloc === 0n && dealloc === 0n) {
    return 'No signed allocation deltas indexed for this tx.';
  }
  if (dealloc > alloc * 2n) {
    return hasLiquidity
      ? 'Risk ↓ — deallocate-heavy + liquidity adapter change.'
      : 'Risk ↓ — capital pulled toward idle / out of markets (deallocate-heavy).';
  }
  if (alloc > dealloc * 2n) {
    return hasLiquidity
      ? 'Risk ↑ — allocate-heavy + liquidity adapter change.'
      : 'Risk ↑ — capital pushed into markets (allocate-heavy).';
  }
  return hasLiquidity
    ? 'Risk ↔ — rebalanced + liquidity adapter change.'
    : 'Risk ↔ — rebalanced across markets (alloc ≈ dealloc).';
}

function nearestApy(
  points: Array<{ x: number; y: number }>,
  targetSec: number,
  mode: 'before' | 'after'
): number | null {
  if (points.length === 0) return null;
  if (mode === 'before') {
    let best: { x: number; y: number } | null = null;
    for (const p of points) {
      if (p.x <= targetSec && (!best || p.x > best.x)) best = p;
    }
    return best ? best.y * 100 : null;
  }
  let best: { x: number; y: number } | null = null;
  for (const p of points) {
    if (p.x >= targetSec && (!best || p.x < best.x)) best = p;
  }
  if (!best) {
    const last = points[points.length - 1];
    return last ? last.y * 100 : null;
  }
  return best.y * 100;
}

async function resolveMarketLabel(
  chainId: number,
  market: DecodedMarketParams | null | undefined,
  cache: Map<string, string | null>
): Promise<string | null> {
  if (!market) return null;
  const cacheKey = market.marketId.toLowerCase();
  if (cache.has(cacheKey)) return cache.get(cacheKey) ?? null;

  let label: string | null = null;

  try {
    const data = await morphoGraphQLClient.request<MarketGraph>(MARKET_BY_ID_QUERY, {
      marketId: market.marketId,
      chainId,
    });
    const m = data.marketById;
    if (m?.loanAsset?.symbol || m?.collateralAsset?.symbol) {
      label = formatMarketNameWithLltv(
        m.collateralAsset?.symbol,
        m.loanAsset?.symbol,
        m.lltv ?? market.lltv
      );
    }
  } catch {
    // fall through
  }

  if (!label) {
    try {
      const data = await morphoGraphQLClient.request<MarketsByAssetsGraph>(
        MARKETS_BY_ASSETS_QUERY,
        {
          chainId,
          loan: [market.loanAsset],
          collateral: [market.collateralAsset],
        }
      );
      const items = (data.markets?.items ?? []).filter(
        (x): x is NonNullable<typeof x> => x != null
      );
      const exact =
        items.find((m) => m.marketId?.toLowerCase() === cacheKey) ??
        items.find((m) => {
          try {
            return BigInt(m.lltv ?? -1) === BigInt(market.lltv);
          } catch {
            return false;
          }
        }) ??
        items[0];
      if (exact) {
        label = formatMarketNameWithLltv(
          exact.collateralAsset?.symbol,
          exact.loanAsset?.symbol,
          exact.lltv ?? market.lltv
        );
      }
    } catch {
      // fall through
    }
  }

  if (!label) {
    // Last resort: still show LLTV from calldata even without GraphQL symbols.
    label = formatMarketNameWithLltv(
      `${market.collateralAsset.slice(0, 6)}…`,
      `${market.loanAsset.slice(0, 6)}…`,
      market.lltv
    );
  }

  cache.set(cacheKey, label);
  return label;
}

function isAllocateGraphType(type: string): boolean {
  const t = type.toLowerCase().replace(/\s+/g, '');
  // Exact Morpho GraphQL / decoded allocate — not GrantAllocator / RevokeAllocator.
  return t === 'allocate' || t === 'vaultv2allocate';
}

function isDeallocateGraphType(type: string): boolean {
  const t = type.toLowerCase().replace(/\s+/g, '');
  return t === 'deallocate' || t === 'vaultv2deallocate';
}

function needsCalldataDecode(candidate: {
  changes: BotActivityChange[];
}): boolean {
  // No GraphQL rows — liquidity-only or sentinel cap/revoke txs from Alchemy.
  if (candidate.changes.length === 0) return true;
  // Enrich market labels + liquidity adapter from calldata when GraphQL ids are not marketIds.
  return candidate.changes.some(
    (ch) =>
      isAllocateGraphType(ch.type) ||
      isDeallocateGraphType(ch.type) ||
      ch.type.toLowerCase().includes('liquidity')
  );
}

function formatCapNewValue(
  kind: 'decreaseAbsoluteCap' | 'decreaseRelativeCap',
  newCap: string,
  assetSymbol: string,
  assetDecimals: number
): string {
  if (kind === 'decreaseRelativeCap') {
    return formatRelativeCapWad(newCap);
  }
  return `${formatRawTokenAmount(
    newCap,
    assetDecimals,
    assetDecimals <= 8 ? 4 : 2
  )} ${assetSymbol}`;
}

/**
 * Panel routing:
 * - Allocator: allocate, rebalance (alloc+dealloc), liquidity adapter switches
 * - Sentinel: deallocate-only (no allocate), cap decreases, revoke pending,
 *   remove allocator — and only when the signer holds the sentinel role
 */
function pickPanel(opts: {
  isAllocator: boolean;
  isSentinel: boolean;
  hasAllocate: boolean;
  hasDeallocate: boolean;
  hasLiquidity: boolean;
  hasSentinelAction: boolean;
}): 'allocator' | 'sentinel' | null {
  const {
    isAllocator,
    isSentinel,
    hasAllocate,
    hasDeallocate,
    hasLiquidity,
    hasSentinelAction,
  } = opts;

  if (!isAllocator && !isSentinel) return null;

  // Any allocate leg → never sentinel (sentinel cannot allocate).
  if (hasAllocate) {
    return isAllocator ? 'allocator' : null;
  }

  // Cap decrease / revoke pending / remove allocator → sentinel panel.
  if (hasSentinelAction && isSentinel) return 'sentinel';

  // Deallocate-only (no allocate) from a sentinel → sentinel panel.
  if (hasDeallocate && !hasAllocate && isSentinel) return 'sentinel';

  // Liquidity adapter (allocator exit-path) without sentinel risk-off actions.
  if (hasLiquidity && isAllocator) return 'allocator';

  // Deallocate from allocator-only addresses (not sentinel) stays on allocator.
  if (hasDeallocate && isAllocator) return 'allocator';

  return null;
}

/**
 * Recent executed Safe transactions that call a tracked vault, directly or
 * inside a MultiSend. Needs the Safe Transaction Service (API key); returns
 * nothing without it.
 */
async function fetchSafeExecutedVaultTxHashes(
  safe: Address,
  vaultSet: Set<string>,
  maxCount = 12
): Promise<Array<{ hash: Hex; to: Address; timestamp: number | null }>> {
  if (!isTransactionServiceConfigured()) return [];
  try {
    const history = await fetchExecutedMultisigTransactions(safe);
    const out: Array<{ hash: Hex; to: Address; timestamp: number | null }> = [];
    for (const tx of history) {
      if (out.length >= maxCount) break;
      if (!tx.transactionHash || tx.isSuccessful === false || !isAddress(tx.to)) continue;
      let vault: string | null = vaultSet.has(tx.to.toLowerCase()) ? tx.to : null;
      if (!vault && tx.operation === 1 && isKnownMultiSend(tx.to) && tx.data) {
        vault =
          decodeMultiSend(tx.data as Hex)?.find((inner) =>
            vaultSet.has(inner.to.toLowerCase())
          )?.to ?? null;
      }
      if (!vault) continue;
      const ts = tx.executionDate
        ? Math.floor(new Date(tx.executionDate).getTime() / 1000)
        : null;
      out.push({
        hash: tx.transactionHash as Hex,
        to: getAddress(vault),
        timestamp: Number.isFinite(ts) ? ts : null,
      });
    }
    return out;
  } catch (error) {
    logger.warn('Safe Transaction Service history failed for bot watcher', {
      safe,
      error: error instanceof Error ? error : new Error(String(error)),
    });
    return [];
  }
}

export async function GET(request: NextRequest) {
  const denied = await unauthorizedUnlessAdmin(request);
  if (denied) return denied;
  const rateLimit = createRateLimitMiddleware(RATE_LIMIT_REQUESTS_PER_MINUTE, MINUTE_MS);
  const rateLimitResult = rateLimit(request);
  if (!rateLimitResult.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please try again later.' },
      { status: 429, headers: rateLimitResult.headers }
    );
  }

  try {
    const url = new URL(request.url);
    const perVault = parseBoundedIntParam(url.searchParams.get('perVault'), 40, { min: 1, max: 100 });
    const limit = parseBoundedIntParam(url.searchParams.get('limit'), 25, { min: 1, max: 50 });
    const panelParam = url.searchParams.get('panel');
    const panelFilter: 'allocator' | 'sentinel' | 'rebater' | 'all' =
      panelParam === 'allocator' ||
      panelParam === 'sentinel' ||
      panelParam === 'rebater' ||
      panelParam === 'all'
        ? panelParam
        : 'all';

    const payload = await withServerResponseCache(
      `bot-activity-v8-${perVault}-${limit}-${panelFilter}`,
      API_CACHE_MAX_AGE_MS,
      async (): Promise<BotActivityResponse> => {
        // Include test vaults — bots may run there.
        const allVaults = getAllVaultAddresses();
        const vaultSet = new Set(allVaults.map((v) => v.address.toLowerCase()));
        const vaultByAddr = new Map(
          allVaults.map((v) => [v.address.toLowerCase(), v] as const)
        );
        const vaultOptions: BotVaultOption[] = allVaults
          .map((v) => ({
            address: getAddress(v.address),
            name: getConfiguredVaultDisplayName(v),
            assetSymbol: v.assetSymbol,
          }))
          .sort((a, b) => a.name.localeCompare(b.name));

        if (panelFilter === 'rebater') {
          const rebater = await fetchRebaterActivity(limit);
          return {
            vaults: vaultOptions,
            allocators: [],
            sentinels: [],
            allocatorItems: [],
            sentinelItems: [],
            rebaterWatchers: rebater.watchers,
            rebaterItems: rebater.items,
            rebaterTruncated: rebater.truncated,
            rebaterError: rebater.error,
          };
        }

        const allocatorSet = new Set<string>();
        const sentinelSet = new Set<string>();

        allocatorSet.add(getSafeByRole('allocator').address.toLowerCase());
        sentinelSet.add(getSafeByRole('sentinel').address.toLowerCase());

        const vaultRefs = allVaults.map((v) => ({
          address: v.address,
          chainId: v.chainId ?? BASE_CHAIN_ID,
        }));
        try {
          const roleMap = await batchVaultV2ByAddress<{
            allocators?: Array<{ allocator?: { address?: string | null } | null } | null> | null;
            sentinels?: Array<{ sentinel?: { address?: string | null } | null } | null>;
          }>(
            vaultRefs,
            `allocators { allocator { address } } sentinels { sentinel { address } }`
          );
          for (const row of roleMap.values()) {
            for (const a of row?.allocators ?? []) {
              const addr = a?.allocator?.address;
              if (addr && isAddress(addr)) allocatorSet.add(addr.toLowerCase());
            }
            for (const s of row?.sentinels ?? []) {
              const a = s?.sentinel?.address;
              if (a && isAddress(a)) sentinelSet.add(a.toLowerCase());
            }
          }
        } catch (error) {
          logger.warn('Failed to batch-fetch vault roles for bot watch', {
            error: error instanceof Error ? error : new Error(String(error)),
          });
        }

        type Candidate = {
          vaultAddress: Address;
          vaultName: string;
          assetSymbol: string;
          chainId: number;
          hash: Hex;
          timestamp: number | null;
          blockNumber: number | null;
          sender: Address | null;
          changes: BotActivityChange[];
        };

        const candidatesByHash = new Map<string, Candidate>();
        const watcherAddresses = Array.from(
          new Set([...allocatorSet, ...sentinelSet])
        ).map((a) => getAddress(a));

        const upsertGraphqlRow = (
          hash: Hex,
          vaultAddress: Address,
          vaultName: string,
          assetSymbol: string,
          chainId: number,
          timestamp: number | null,
          blockNumber: number | null,
          sender: Address | null,
          change: BotActivityChange
        ) => {
          const key = hash.toLowerCase();
          const existing = candidatesByHash.get(key);
          if (existing) {
            existing.changes.push(change);
            if (sender) existing.sender = sender;
            if (timestamp != null && (existing.timestamp == null || timestamp > existing.timestamp)) {
              existing.timestamp = timestamp;
            }
            if (blockNumber != null && existing.blockNumber == null) {
              existing.blockNumber = blockNumber;
            }
          } else {
            candidatesByHash.set(key, {
              vaultAddress,
              vaultName,
              assetSymbol,
              chainId,
              hash,
              timestamp,
              blockNumber,
              sender,
              changes: [change],
            });
          }
        };

        try {
          const reallocMap = await batchVaultV2AllocationTransactions<{
            items?: Array<{
              txHash?: string | null;
              sender?: string | null;
              timestamp?: number | string | null;
              blockNumber?: number | string | null;
              type?: string | null;
              change?: string | number | null;
              assets?: string | number | null;
              ids?: string[] | null;
              adapter?: string | null;
            } | null> | null;
          }>(vaultRefs, perVault, watcherAddresses);
          for (const vault of allVaults) {
            const vaultAddress = getAddress(vault.address);
            const chainId = vault.chainId ?? BASE_CHAIN_ID;
            const assetSymbol = vault.assetSymbol;
            const vaultName = getConfiguredVaultDisplayName(vault);
            const packed = reallocMap.get(vault.address.toLowerCase());
            for (const item of packed?.items ?? []) {
              if (!item?.txHash) continue;
              const rowSender =
                item.sender && isAddress(item.sender) ? getAddress(item.sender) : null;
              upsertGraphqlRow(
                item.txHash as Hex,
                vaultAddress,
                vaultName,
                assetSymbol,
                chainId,
                item.timestamp != null ? Number(item.timestamp) : null,
                item.blockNumber != null ? Number(item.blockNumber) : null,
                rowSender,
                {
                  type: item.type ?? 'Unknown',
                  change: item.change != null ? String(item.change) : null,
                  assets: item.assets != null ? String(item.assets) : null,
                  allocationId: item.ids?.[0] ?? null,
                  adapterAddress: item.adapter ?? null,
                }
              );
            }
          }
        } catch (error) {
          logger.warn('Failed to batch-fetch reallocations for bot filter', {
            error: error instanceof Error ? error : new Error(String(error)),
          });
        }

        // Supplement with role-Safe executions (Transaction Service history) so
        // Safe-executed cap decreases, revokes, and liquidity switches show up.
        const alchemyWatchers: Address[] = [];
        if (panelFilter === 'all' || panelFilter === 'allocator') {
          alchemyWatchers.push(getSafeByRole('allocator').address);
        }
        if (panelFilter === 'all' || panelFilter === 'sentinel') {
          alchemyWatchers.push(getSafeByRole('sentinel').address);
        }
        const alchemyUnique = Array.from(
          new Set(alchemyWatchers.map((a) => a.toLowerCase()))
        ).map((a) => getAddress(a));

        await Promise.all(
          alchemyUnique.map(async (addr) => {
            // Safes are contracts: they never start a top-level ("external")
            // transfer, so Alchemy has nothing for them. Their executions come
            // from the Transaction Service history instead.
            const transfers = await fetchSafeExecutedVaultTxHashes(addr, vaultSet, 12);
            for (const t of transfers) {
              const key = t.hash.toLowerCase();
              if (candidatesByHash.has(key)) continue;
              const cfg = vaultByAddr.get(t.to.toLowerCase());
              if (!cfg) continue;
              candidatesByHash.set(key, {
                vaultAddress: t.to,
                vaultName: getConfiguredVaultDisplayName(cfg),
                assetSymbol: cfg.assetSymbol,
                chainId: cfg.chainId ?? BASE_CHAIN_ID,
                hash: t.hash,
                timestamp: t.timestamp,
                blockNumber: null,
                sender: addr,
                changes: [],
              });
            }
          })
        );

        const sorted = Array.from(candidatesByHash.values()).sort(
          (a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0)
        );

        type Matched = Candidate & {
          from: Address;
          actorLabel: string;
          actorKind: BotActivityItem['actorKind'];
          panel: 'allocator' | 'sentinel';
          liquidityMarketLabel: string | null;
          liquidityMarketId: string | null;
        };

        const matched: Matched[] = [];
        const BATCH = 8;
        const marketLabelCache = new Map<string, string | null>();

        for (let i = 0; i < sorted.length && matched.length < limit * 2; i += BATCH) {
          const slice = sorted.slice(i, i + BATCH);
          const rows = await Promise.all(
            slice.map(async (c) => {
              try {
                let decoded: DecodedVaultCallSummary = {
                  hasAllocate: false,
                  hasDeallocate: false,
                  hasSentinelAction: false,
                  liquiditySwitch: null,
                  allocationLegs: [],
                  capChanges: [],
                  roleChanges: [],
                };

                if (needsCalldataDecode(c)) {
                  const tx = await publicClient.getTransaction({ hash: c.hash });
                  // A role Safe acts through execTransaction: the vault's
                  // msg.sender is the Safe (tx.to), not the executing EOA.
                  const unwrapped = decodeTransactionVaultCalls(tx.input, c.vaultAddress);
                  if (!c.sender) {
                    if (unwrapped.viaSafe && tx.to) c.sender = getAddress(tx.to);
                    else if (tx.from) c.sender = getAddress(tx.from);
                  }
                  decoded = unwrapped.summary;
                }

                const from = c.sender;
                if (!from) return null;

                const resolvedFromKey = from.toLowerCase();
                const resolvedAllocator = allocatorSet.has(resolvedFromKey);
                const resolvedSentinel = sentinelSet.has(resolvedFromKey);
                if (!resolvedAllocator && !resolvedSentinel) return null;

                let changes = [...c.changes];

                let liquidityMarketLabel: string | null = null;
                let liquidityMarketId: string | null = null;

                // Prefer calldata-decoded legs (include market params) over bare GraphQL rows.
                if (decoded.allocationLegs.length > 0) {
                  const labeledLegs = await Promise.all(
                    decoded.allocationLegs.map(async (leg) => {
                      const marketLabel = await resolveMarketLabel(
                        c.chainId,
                        leg.market,
                        marketLabelCache
                      );
                      return {
                        type: leg.kind === 'allocate' ? 'Allocate' : 'Deallocate',
                        change: leg.kind === 'deallocate' ? `-${leg.assets}` : leg.assets,
                        assets: leg.assets,
                        allocationId: leg.market?.marketId ?? null,
                        adapterAddress: leg.adapterAddress,
                        marketLabel,
                        marketId: leg.market?.marketId ?? null,
                      } satisfies BotActivityChange;
                    })
                  );
                  // Keep any GraphQL-only events that aren't allocate/deallocate
                  // (rare), then use decoded legs as the source of truth.
                  const nonAlloc = changes.filter((ch) => {
                    return (
                      !isAllocateGraphType(ch.type) &&
                      !isDeallocateGraphType(ch.type) &&
                      !ch.type.toLowerCase().includes('liquidity')
                    );
                  });
                  changes = [...nonAlloc, ...labeledLegs];
                }

                if (decoded.liquiditySwitch) {
                  const sw = decoded.liquiditySwitch;
                  liquidityMarketId = sw.market?.marketId ?? null;
                  liquidityMarketLabel = await resolveMarketLabel(
                    c.chainId,
                    sw.market,
                    marketLabelCache
                  );
                  const already = changes.some((ch) =>
                    ch.type.toLowerCase().includes('liquidity')
                  );
                  if (!already) {
                    changes.push({
                      type: 'LiquidityAdapter',
                      change: null,
                      assets: null,
                      allocationId: sw.market?.marketId ?? null,
                      adapterAddress: sw.adapterAddress,
                      marketLabel: liquidityMarketLabel,
                      marketId: sw.market?.marketId ?? null,
                    });
                  } else {
                    changes = changes.map((ch) =>
                      ch.type.toLowerCase().includes('liquidity')
                        ? {
                            ...ch,
                            marketLabel: liquidityMarketLabel ?? ch.marketLabel,
                            marketId: liquidityMarketId ?? ch.marketId,
                          }
                        : ch
                    );
                  }
                }

                const assetDecimals = assetDecimalsForSymbol(c.assetSymbol);

                for (const cap of decoded.capChanges) {
                  const marketLabel = await resolveMarketLabel(
                    c.chainId,
                    cap.market,
                    marketLabelCache
                  );
                  const capLabel =
                    marketLabel ??
                    (cap.capKind === 'adapter' && cap.adapterAddress
                      ? `Adapter ${cap.adapterAddress.slice(0, 6)}…`
                      : cap.capKind === 'collateral' && cap.collateralAddress
                        ? `Collateral ${cap.collateralAddress.slice(0, 6)}…`
                        : 'Cap');
                  changes.push({
                    type:
                      cap.kind === 'decreaseAbsoluteCap'
                        ? 'DecreaseAbsoluteCap'
                        : 'DecreaseRelativeCap',
                    change: formatCapNewValue(
                      cap.kind,
                      cap.newCap,
                      c.assetSymbol,
                      assetDecimals
                    ),
                    assets: cap.newCap,
                    allocationId: cap.market?.marketId ?? null,
                    adapterAddress: cap.adapterAddress ?? null,
                    marketLabel: capLabel,
                    marketId: cap.market?.marketId ?? null,
                  });
                }

                for (const role of decoded.roleChanges) {
                  if (role.kind === 'revoke') {
                    changes.push({
                      type: 'RevokePending',
                      change: null,
                      assets: null,
                      allocationId: null,
                      adapterAddress: null,
                      marketLabel: 'Revoke pending timelock action',
                    });
                    continue;
                  }
                  const account = role.account;
                  if (!account) continue;
                  changes.push({
                    type: role.isAllocator ? 'GrantAllocator' : 'RevokeAllocator',
                    change: null,
                    assets: null,
                    allocationId: null,
                    adapterAddress: account,
                    marketLabel: `${role.isAllocator ? 'Grant' : 'Revoke'} allocator ${account.slice(0, 6)}…${account.slice(-4)}`,
                  });
                }

                // Drop empty candidates (Alchemy-only with undecodable input).
                if (changes.length === 0) return null;

                const graphqlHasAllocate = changes.some((ch) =>
                  isAllocateGraphType(ch.type)
                );
                const graphqlHasDeallocate = changes.some((ch) =>
                  isDeallocateGraphType(ch.type)
                );
                const hasAllocate = decoded.hasAllocate || graphqlHasAllocate;
                const hasDeallocate = decoded.hasDeallocate || graphqlHasDeallocate;
                const hasLiquidity = Boolean(decoded.liquiditySwitch);
                const hasSentinelAction =
                  decoded.hasSentinelAction ||
                  changes.some((ch) => {
                    const t = ch.type.toLowerCase();
                    return (
                      (t.includes('decrease') && t.includes('cap')) ||
                      t === 'revokeallocator' ||
                      t === 'revokepending'
                    );
                  });

                const panel = pickPanel({
                  isAllocator: resolvedAllocator,
                  isSentinel: resolvedSentinel,
                  hasAllocate,
                  hasDeallocate,
                  hasLiquidity,
                  hasSentinelAction,
                });
                if (!panel) return null;
                if (panelFilter === 'allocator' && panel !== 'allocator') return null;
                if (panelFilter === 'sentinel' && panel !== 'sentinel') return null;

                const actor = labelForActor(from);
                return {
                  ...c,
                  changes,
                  from,
                  actorLabel: actor.label,
                  actorKind: actor.kind,
                  panel,
                  liquidityMarketLabel,
                  liquidityMarketId,
                } satisfies Matched;
              } catch {
                return null;
              }
            })
          );

          for (const row of rows) {
            if (!row) continue;
            matched.push(row);
          }
        }

        const apySeriesByVault = new Map<string, Array<{ x: number; y: number }>>();
        const vaultApyWindows = new Map<
          string,
          { address: Address; chainId: number; minTs: number; maxTs: number }
        >();
        for (const row of matched) {
          if (row.timestamp == null) continue;
          const key = `${row.chainId}:${row.vaultAddress.toLowerCase()}`;
          const existing = vaultApyWindows.get(key);
          if (existing) {
            existing.minTs = Math.min(existing.minTs, row.timestamp);
            existing.maxTs = Math.max(existing.maxTs, row.timestamp);
          } else {
            vaultApyWindows.set(key, {
              address: row.vaultAddress,
              chainId: row.chainId,
              minTs: row.timestamp,
              maxTs: row.timestamp,
            });
          }
        }
        await Promise.all(
          Array.from(vaultApyWindows.entries()).map(async ([key, win]) => {
            const startTimestamp = Math.max(0, win.minTs - 3 * 24 * 60 * 60);
            const endTimestamp = win.maxTs + 3 * 24 * 60 * 60;
            try {
              const data = await morphoGraphQLClient.request<ApyGraph>(APY_QUERY, {
                address: win.address,
                chainId: win.chainId,
                options: { startTimestamp, endTimestamp },
              });
              const raw = data.vaultV2ByAddress?.historicalState?.avgNetApy ?? [];
              const points = raw
                .filter((p): p is { x: number; y: number } => p?.x != null && p?.y != null)
                .map((p) => ({ x: Number(p.x), y: Number(p.y) }))
                .sort((a, b) => a.x - b.x);
              apySeriesByVault.set(key, points);
            } catch {
              apySeriesByVault.set(key, []);
            }
          })
        );

        const enrich = async (row: Matched): Promise<BotActivityItem> => {
          const cfg = vaultByAddr.get(row.vaultAddress.toLowerCase());
          const symbol =
            getVaultAssetSymbol(row.vaultAddress) ?? cfg?.assetSymbol ?? row.assetSymbol;
          const seriesKey = `${row.chainId}:${row.vaultAddress.toLowerCase()}`;
          const points = apySeriesByVault.get(seriesKey) ?? [];
          const apy =
            row.timestamp != null
              ? {
                  before: nearestApy(points, row.timestamp, 'before'),
                  after: nearestApy(points, row.timestamp + 1, 'after'),
                }
              : { before: null, after: null };
          const apyDeltaPp =
            apy.before != null && apy.after != null ? apy.after - apy.before : null;
          return {
            hash: row.hash,
            timestamp: row.timestamp,
            blockNumber: row.blockNumber,
            from: row.from,
            actorLabel: row.actorLabel,
            actorKind: row.actorKind,
            vaultAddress: row.vaultAddress,
            vaultName: row.vaultName,
            assetSymbol: symbol,
            assetDecimals: assetDecimalsForSymbol(symbol),
            panel: row.panel,
            changes: row.changes,
            liquidityMarketLabel: row.liquidityMarketLabel,
            liquidityMarketId: row.liquidityMarketId,
            apyBefore: apy.before,
            apyAfter: apy.after,
            apyDeltaPp,
            riskNote: riskNoteFromChanges(row.changes),
          };
        };

        const items = await Promise.all(matched.map(enrich));
        items.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));

        const allocatorItems = items
          .filter((i) => i.panel === 'allocator')
          .slice(0, limit);
        const sentinelItems = items
          .filter((i) => i.panel === 'sentinel')
          .slice(0, limit);

        const toWatchers = (set: Set<string>): BotWatcher[] =>
          Array.from(set)
            .map((a) => {
              const info = labelForActor(a);
              return {
                address: getAddress(a),
                label: info.label,
                kind: info.kind,
              };
            })
            .sort((a, b) => {
              const rank = (k: string) =>
                k === 'allocator_safe' || k === 'sentinel_safe'
                  ? 0
                  : k === 'public_allocator'
                    ? 1
                    : 2;
              return rank(a.kind) - rank(b.kind) || a.label.localeCompare(b.label);
            });

        return {
          vaults: vaultOptions,
          allocators: toWatchers(allocatorSet),
          sentinels: toWatchers(sentinelSet),
          allocatorItems,
          sentinelItems,
          rebaterWatchers: [],
          rebaterItems: [],
          rebaterTruncated: false,
          rebaterError: null,
        };
      }
    );

    const headers = mergeApiCacheHeaders(rateLimitResult.headers, 60);
    return NextResponse.json(payload, { headers });
  } catch (error) {
    const { error: apiError, statusCode } = handleApiError(
      error,
      'Failed to fetch bot activity'
    );
    return NextResponse.json(apiError, { status: statusCode });
  }
}
