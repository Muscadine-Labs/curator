import { createPublicClient, getAddress, http, parseAbiItem, type Address } from 'viem';
import { base } from '@/lib/onchain/base-chain';
import { publicClient } from '@/lib/onchain/client';
import { BASE_PUBLIC_RPC, getBaseRpcUrl } from '@/lib/onchain/rpc-url';
import { logger } from '@/lib/utils/logger';

/**
 * Every account a WhitelistSendAssetsGate has ever flagged, recovered from its
 * events. The gate keeps `isWhitelisted` / `isWhitelister` as plain mappings,
 * so there is no on-chain enumeration — without a log scan the curator UI can
 * only check addresses it already knows about, and a partner whitelisted from
 * the gate form would never show up.
 *
 * Events only nominate candidates; callers still read the live mappings to
 * decide who is currently whitelisted.
 *
 * The first scan of a gate walks its whole history in 2,000-block chunks, which
 * on the public Base RPC takes tens of seconds. Each request therefore scans
 * for at most `SCAN_BUDGET_MS` and keeps its progress in memory; callers get
 * `complete: false` until the scan catches up to the chain head, then later
 * requests only read the handful of new blocks.
 */
const ROSTER_EVENTS = [
  parseAbiItem('event SetIsWhitelister(address indexed account, bool newIsWhitelister)'),
  parseAbiItem(
    'event SetIsWhitelisted(address indexed whitelister, address indexed account, bool newIsWhitelisted)'
  ),
  parseAbiItem(
    'event SetIsWhitelistedWithSig(address indexed whitelister, address indexed account, bool newIsWhitelisted)'
  ),
] as const;

/** `mainnet.base.org` rejects `eth_getLogs` spans above 2,000 blocks. */
const LOG_CHUNK_BLOCKS = 2_000n;
const SCAN_CONCURRENCY = 6;
const SCAN_BUDGET_MS = 6_000;
/** Public RPCs answer bursts with "over rate limit"; back off and retry the chunk. */
const CHUNK_RETRIES = 4;
const CHUNK_RETRY_BASE_MS = 400;

type LogsClient = Pick<typeof publicClient, 'getLogs'>;

/**
 * Keyed RPCs can cap `eth_getLogs` far below 2,000 blocks on free tiers, so a
 * chunk that fails on the configured RPC retries on the public Base endpoint.
 */
const publicLogsClient: LogsClient = createPublicClient({
  chain: base,
  transport: http(BASE_PUBLIC_RPC),
});

type RosterState = {
  /** First block not yet scanned. */
  nextBlock: bigint;
  firstBlock: bigint;
  accounts: Set<Address>;
};

type RosterProgress = { complete: boolean; progress: number };

const rosterStates = new Map<string, RosterState>();
const inFlight = new Map<string, Promise<RosterProgress>>();
const deployBlocks = new Map<string, Promise<bigint>>();

async function findDeployBlock(gate: Address, latest: bigint): Promise<bigint> {
  let lo = 0n;
  let hi = latest;
  while (lo < hi) {
    const mid = (lo + hi) / 2n;
    const code = await publicClient.getCode({ address: gate, blockNumber: mid });
    if (code && code !== '0x') hi = mid;
    else lo = mid + 1n;
  }
  return lo;
}

function resolveDeployBlock(
  gate: Address,
  latest: bigint,
  knownDeployBlock: bigint | null
): Promise<bigint> {
  if (knownDeployBlock != null) return Promise.resolve(knownDeployBlock);
  const key = gate.toLowerCase();
  const cached = deployBlocks.get(key);
  if (cached) return cached;
  const pending = findDeployBlock(gate, latest);
  deployBlocks.set(key, pending);
  pending.catch(() => deployBlocks.delete(key));
  return pending;
}

function collectAccounts(
  logs: ReadonlyArray<{ args: { account?: Address; whitelister?: Address } }>,
  into: Set<Address>
) {
  for (const log of logs) {
    if (log.args.account) into.add(getAddress(log.args.account));
    if (log.args.whitelister) into.add(getAddress(log.args.whitelister));
  }
}

function getRosterLogs(
  client: LogsClient,
  gate: Address,
  fromBlock: bigint,
  toBlock: bigint
) {
  return client.getLogs({ address: gate, events: ROSTER_EVENTS, fromBlock, toBlock });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getChunkLogs(gate: Address, fromBlock: bigint, toBlock: bigint) {
  const clients: LogsClient[] =
    getBaseRpcUrl() === BASE_PUBLIC_RPC ? [publicClient] : [publicClient, publicLogsClient];
  let lastError: unknown;
  for (const client of clients) {
    for (let attempt = 0; attempt <= CHUNK_RETRIES; attempt += 1) {
      try {
        return await getRosterLogs(client, gate, fromBlock, toBlock);
      } catch (error) {
        lastError = error;
        if (attempt < CHUNK_RETRIES) await sleep(CHUNK_RETRY_BASE_MS * 2 ** attempt);
      }
    }
  }
  throw lastError;
}

function progressOf(state: RosterState, latest: bigint): RosterProgress {
  const complete = state.nextBlock > latest;
  const total = latest - state.firstBlock + 1n;
  if (complete || total <= 0n) return { complete, progress: complete ? 1 : 0 };
  const done = state.nextBlock - state.firstBlock;
  return { complete, progress: Number((done * 1000n) / total) / 1000 };
}

async function advanceRoster(
  gate: Address,
  knownDeployBlock: bigint | null
): Promise<RosterProgress> {
  const key = gate.toLowerCase();
  const latest = await publicClient.getBlockNumber();
  let state = rosterStates.get(key);
  if (!state) {
    const firstBlock = await resolveDeployBlock(gate, latest, knownDeployBlock);
    state = { nextBlock: firstBlock, firstBlock, accounts: new Set() };
    rosterStates.set(key, state);
  }
  if (state.nextBlock > latest) return progressOf(state, latest);

  // Providers without a span cap answer the whole backlog in one call.
  if (latest - state.nextBlock + 1n > LOG_CHUNK_BLOCKS) {
    try {
      collectAccounts(
        await getRosterLogs(publicClient, gate, state.nextBlock, latest),
        state.accounts
      );
      state.nextBlock = latest + 1n;
      return progressOf(state, latest);
    } catch {
      // Span too large for this RPC — scan in chunks below.
    }
  }

  const deadline = Date.now() + SCAN_BUDGET_MS;
  while (state.nextBlock <= latest && Date.now() < deadline) {
    const batch: Array<[bigint, bigint]> = [];
    let start = state.nextBlock;
    while (batch.length < SCAN_CONCURRENCY && start <= latest) {
      const end = start + LOG_CHUNK_BLOCKS - 1n;
      batch.push([start, end > latest ? latest : end]);
      start = end + 1n;
    }
    const results = await Promise.all(batch.map(([from, to]) => getChunkLogs(gate, from, to)));
    for (const logs of results) collectAccounts(logs, state.accounts);
    // Batches are contiguous and all-or-nothing, so progress never skips a gap.
    state.nextBlock = batch[batch.length - 1]![1] + 1n;
  }
  return progressOf(state, latest);
}

export type GateRosterScanStatus = 'complete' | 'scanning' | 'failed';

export type GateRosterCandidates = {
  accounts: Address[];
  /** `scanning` while the first pass is still catching up to the chain head. */
  status: GateRosterScanStatus;
  /** Share of the gate's history scanned so far (0–1). */
  progress: number;
};

export async function readGateRosterCandidates(
  gate: Address,
  knownDeployBlock: bigint | null
): Promise<GateRosterCandidates> {
  const key = gate.toLowerCase();
  let pending = inFlight.get(key);
  if (!pending) {
    pending = advanceRoster(gate, knownDeployBlock).finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
  }
  let status: GateRosterScanStatus;
  let progress = 0;
  try {
    const result = await pending;
    status = result.complete ? 'complete' : 'scanning';
    progress = result.progress;
  } catch (error) {
    logger.warn('Send-assets gate event scan failed', {
      gate,
      error: error instanceof Error ? error : new Error(String(error)),
    });
    status = 'failed';
  }
  const state = rosterStates.get(key);
  return { accounts: state ? [...state.accounts] : [], status, progress };
}
