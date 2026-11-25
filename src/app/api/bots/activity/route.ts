import { NextRequest, NextResponse } from 'next/server';
import { parseBoundedIntParam } from '@/lib/api/query-params';
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
  decodeVaultV2CalldataList,
  type DecodedMarketParams,
  type DecodedVaultCallSummary,
} from '@/lib/bots/decode-vault-calls';
import { formatMarketNameWithLltv } from '@/lib/morpho/market-label';
import { formatRelativeCapWad } from '@/lib/morpho/vault-v2-api';
import { formatRawTokenAmount } from '@/lib/format/number';
import { morphoRestGet, morphoSelector } from '@/lib/morpho/rest-client';
import { getRestMarket, getRestToken, getRestVaultRoleAddresses } from '@/lib/morpho/rest-data';
import { realizedApySeries } from '@/lib/morpho/vault-history';
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
import { isTransactionServiceConfigured } from '@/lib/safe/transaction-service';
import { fetchRebaterActivity, type RebaterActivityItem, type RebaterWatcher } from '@/lib/bots/rebater-activity';
import { unauthorizedUnlessAdmin } from '@/lib/auth/require-admin';
import { loadSafeHistory } from '@/lib/morpho/vault-activity.server';

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
    const m = await getRestMarket(chainId, market.marketId);
    const [loan, collateral] = await Promise.all([
      getRestToken(chainId, m.loan_token).catch(() => null),
      m.collateral_token ? getRestToken(chainId, m.collateral_token).catch(() => null) : Promise.resolve(null),
    ]);
    if (loan?.symbol || collateral?.symbol) {
      label = formatMarketNameWithLltv(collateral?.symbol, loan?.symbol, m.lltv_wad ?? market.lltv);
    }
  } catch {
    // fall through
  }

  if (!label) {
    // Last resort: still show LLTV from calldata even without token symbols.
    label = formatMarketNameWithLltv(
      `${market.collateralAsset.slice(0, 6)}…`,
      `${market.loanAsset.slice(0, 6)}…`,
      market.lltv
    );
  }

  cache.set(cacheKey, label);
  return label;
}

/**
 * Vault net APY points around bot transactions, from Morpho REST: `apy/history?lookback=seven_days`
 * (hourly, 1-day trailing averages) when the oldest tx is within the last week, else the realized
 * daily APY from the share price (`state/history?lookback=inception`).
 */
async function loadApySeriesAround(chainId: number, address: string, minTs: number): Promise<Array<{ x: number; y: number }>> {
  const selector = morphoSelector(chainId, address);
  const now = Math.floor(Date.now() / 1000);
  if (now - minTs < 6 * 86_400) {
    const points = await morphoRestGet<Array<{ timestamp: number; apy: number | null }>>(
      `/v0/vaults-v2/${selector}/apy/history`,
      { lookback: 'seven_days' }
    );
    return (points ?? [])
      .filter((p) => typeof p.apy === 'number' && Number.isFinite(p.apy))
      .map((p) => ({ x: p.timestamp, y: p.apy as number }))
      .sort((a, b) => a.x - b.x);
  }
  const points = await morphoRestGet<Array<{ timestamp: number; share_price_ray?: string | null }>>(
    `/v0/vaults-v2/${selector}/state/history`,
    { lookback: 'inception' }
  );
  return realizedApySeries(points ?? [], []);
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
): Promise<Array<{ hash: Hex; to: Address; timestamp: number | null; vaultCalls: Hex[] }>> {
  if (!isTransactionServiceConfigured()) return [];
  try {
    // Same per-Safe cache as the vault Activity feed: one Transaction Service
    // read per Safe per 30s, shared across pages.
    const { txs: history } = await loadSafeHistory(safe);
    const out: Array<{ hash: Hex; to: Address; timestamp: number | null; vaultCalls: Hex[] }> = [];
    for (const tx of history) {
      if (out.length >= maxCount) break;
      if (!tx.transactionHash || tx.isSuccessful === false || !isAddress(tx.to)) continue;
      let vault: string | null = null;
      let vaultCalls: Hex[] = [];
      if (vaultSet.has(tx.to.toLowerCase()) && tx.operation === 0) {
        vault = tx.to;
        vaultCalls = tx.data ? [tx.data as Hex] : [];
      } else if (tx.operation === 1 && isKnownMultiSend(tx.to) && tx.data) {
        const inner = (decodeMultiSend(tx.data as Hex) ?? []).filter(
          (c) => c.operation === 0 && vaultSet.has(c.to.toLowerCase())
        );
        vault = inner[0]?.to ?? null;
        vaultCalls = inner.filter((c) => c.to.toLowerCase() === vault?.toLowerCase()).map((c) => c.data);
      }
      if (!vault) continue;
      const ts = tx.executionDate
        ? Math.floor(new Date(tx.executionDate).getTime() / 1000)
        : null;
      out.push({
        hash: tx.transactionHash as Hex,
        to: getAddress(vault),
        timestamp: Number.isFinite(ts) ? ts : null,
        vaultCalls,
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

        try {
          const roles = await Promise.all(
            allVaults.map(async (v) => {
              const chainId = v.chainId ?? BASE_CHAIN_ID;
              const [allocators, sentinels] = await Promise.all([
                getRestVaultRoleAddresses(chainId, v.address, 'allocators'),
                getRestVaultRoleAddresses(chainId, v.address, 'sentinels'),
              ]);
              return { allocators, sentinels };
            })
          );
          for (const row of roles) {
            for (const addr of row.allocators) if (isAddress(addr)) allocatorSet.add(addr.toLowerCase());
            for (const addr of row.sentinels) if (isAddress(addr)) sentinelSet.add(addr.toLowerCase());
          }
        } catch (error) {
          logger.warn('Failed to fetch vault roles for bot watch', {
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
          /** Vault calldata already known from Safe history — no RPC needed to decode. */
          safeVaultCalls?: Hex[];
        };

        const candidatesByHash = new Map<string, Candidate>();
        // Allocations by the watched wallets used to come from Morpho GraphQL
        // `vaultV2AllocationTransactions`, which Morpho removes on 2026-12-02. REST
        // has no per-sender allocation list, so candidates come from the role
        // Safes' executed history below.
        // Role-Safe executions (Transaction Service history): allocations, cap
        // decreases, revokes and liquidity switches executed through the Safes.
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
              const existing = candidatesByHash.get(key);
              if (existing) {
                existing.safeVaultCalls ??= t.vaultCalls;
                existing.sender ??= addr;
                continue;
              }
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
                safeVaultCalls: t.vaultCalls,
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

                if (needsCalldataDecode(c) && c.safeVaultCalls) {
                  // Safe history already gave the inner vault calls.
                  decoded = decodeVaultV2CalldataList(c.safeVaultCalls);
                } else if (needsCalldataDecode(c)) {
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
            try {
              apySeriesByVault.set(key, await loadApySeriesAround(win.chainId, win.address, win.minTs));
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
