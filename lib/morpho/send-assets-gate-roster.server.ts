import { decodeEventLog, getAddress, type Address, type Hex } from 'viem';
import { publicClient } from '@/lib/onchain/client';
import { withServerResponseCache } from '@/lib/api/server-response-cache';
import { API_CACHE_MAX_AGE_MS } from '@/lib/api/response-cache';
import { logger } from '@/lib/utils/logger';

/**
 * Accounts a WhitelistSendAssetsGate has ever flagged.
 *
 * The mappings `isWhitelisted` / `isWhitelister` cannot be listed on-chain, so
 * candidates come from the gate's own logs: one address-scoped lookup, not a
 * walk of every block. Logs only nominate candidates. Callers still read the
 * live mappings.
 *
 * Sources, first answer wins:
 *  1. Blockscout PRO API (`BLOCKSCOUT_API_KEY`, free key at dev.blockscout.com).
 *  2. Etherscan V2 (`ETHERSCAN_API_KEY`; Base needs a paid plan).
 *  3. Keyless `base.blockscout.com`. Cloudflare answers most server requests
 *     with a bot challenge (HTTP 403 HTML), which is why this lookup used to
 *     fail on every deploy.
 *  4. The configured Base RPC, one `eth_getLogs` over the whole chain. Works on
 *     paid Alchemy / node plans; free Alchemy caps the span at 10 blocks.
 */
const ROSTER_EVENTS = [
  {
    type: 'event',
    name: 'SetIsWhitelister',
    inputs: [
      { name: 'account', type: 'address', indexed: true },
      { name: 'newIsWhitelister', type: 'bool', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'SetIsWhitelisted',
    inputs: [
      { name: 'whitelister', type: 'address', indexed: true },
      { name: 'account', type: 'address', indexed: true },
      { name: 'newIsWhitelisted', type: 'bool', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'SetIsWhitelistedWithSig',
    inputs: [
      { name: 'whitelister', type: 'address', indexed: true },
      { name: 'account', type: 'address', indexed: true },
      { name: 'newIsWhitelisted', type: 'bool', indexed: false },
    ],
  },
] as const;

/** Etherscan-style `getLogs` returns at most this many logs per call. */
const LOG_PAGE_SIZE = 1_000;
const MAX_LOG_PAGES = 20;
const FETCH_TIMEOUT_MS = 15_000;

/**
 * Time budget for one roster lookup. The whole fallback chain must finish
 * inside `withServerResponseCache`'s 40s loader timeout, or the caller gets an
 * empty failure even when a later source would have answered. Explorers share
 * `totalMs - rpcReserveMs`; the RPC fallback always keeps its reserve.
 */
export type GateLookupBudget = { totalMs: number; rpcReserveMs: number };
const DEFAULT_LOOKUP_BUDGET: GateLookupBudget = { totalMs: 32_000, rpcReserveMs: 10_000 };
const BASE_CHAIN_ID = 8453;

type ExplorerLog = {
  blockNumber?: string;
  data?: string;
  topics?: Array<string | null>;
};

export type GateRosterStatus = 'complete' | 'failed';

export type GateRosterCandidates = {
  accounts: Address[];
  /** `failed` means no log source answered in full, so the list may miss accounts. */
  status: GateRosterStatus;
  /** Why the lookup failed, safe to show in the UI (no URLs or keys). */
  reason?: string;
};

function isHexTopic(topic: string | null | undefined): topic is Hex {
  return typeof topic === 'string' && /^0x[0-9a-fA-F]*$/.test(topic);
}

/** Addresses named by one roster log. Ignores the constructor and unknown events. */
export function accountsFromGateLog(log: {
  data?: string | null;
  topics?: ReadonlyArray<string | null> | null;
}): Address[] {
  const topics = (log.topics ?? []).filter(isHexTopic);
  if (topics.length === 0) return [];
  const data = isHexTopic(log.data) ? log.data : '0x';
  try {
    const decoded = decodeEventLog({
      abi: ROSTER_EVENTS,
      data,
      topics: topics as [Hex, ...Hex[]],
    });
    const args = decoded.args as { account?: Address; whitelister?: Address };
    const found: Address[] = [];
    if (args.account) found.push(getAddress(args.account));
    if (args.whitelister) found.push(getAddress(args.whitelister));
    return found;
  } catch {
    return [];
  }
}

/** A source failure whose message is safe to return to the browser. */
class LogSourceError extends Error {}

type ExplorerSource = {
  name: string;
  /** Builds the URL for one page. Holds the API key, so never log or return it. */
  url: (gate: Address, fromBlock: bigint) => URL;
};

function explorerSources(): ExplorerSource[] {
  const sources: ExplorerSource[] = [];
  const blockscoutKey = process.env.BLOCKSCOUT_API_KEY?.trim();
  if (blockscoutKey) {
    sources.push({
      name: 'Blockscout API',
      url: (gate, fromBlock) => {
        const url = logsUrl(`https://api.blockscout.com/${BASE_CHAIN_ID}/api`, gate, fromBlock);
        url.searchParams.set('apikey', blockscoutKey);
        return url;
      },
    });
  }
  const etherscanKey = process.env.ETHERSCAN_API_KEY?.trim();
  if (etherscanKey) {
    sources.push({
      name: 'Etherscan',
      url: (gate, fromBlock) => {
        const url = logsUrl('https://api.etherscan.io/v2/api', gate, fromBlock);
        url.searchParams.set('chainid', String(BASE_CHAIN_ID));
        url.searchParams.set('apikey', etherscanKey);
        return url;
      },
    });
  }
  sources.push({
    name: 'Blockscout (no key)',
    url: (gate, fromBlock) => logsUrl('https://base.blockscout.com/api', gate, fromBlock),
  });
  return sources;
}

function logsUrl(base: string, gate: Address, fromBlock: bigint): URL {
  const url = new URL(base);
  url.searchParams.set('module', 'logs');
  url.searchParams.set('action', 'getLogs');
  url.searchParams.set('address', gate);
  url.searchParams.set('fromBlock', fromBlock.toString());
  url.searchParams.set('toBlock', 'latest');
  return url;
}

async function fetchExplorerPage(
  source: ExplorerSource,
  gate: Address,
  fromBlock: bigint,
  deadline: number
): Promise<ExplorerLog[]> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new LogSourceError('skipped, out of time');
  let response: Response;
  try {
    response = await fetch(source.url(gate, fromBlock), {
      headers: { accept: 'application/json', 'user-agent': 'muscadine-curator' },
      cache: 'no-store',
      signal: AbortSignal.timeout(Math.min(FETCH_TIMEOUT_MS, remaining)),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    throw new LogSourceError(timedOut ? 'timed out' : 'network error');
  }
  const text = await response.text();
  let body: { status?: string; message?: string; result?: unknown; error?: unknown };
  try {
    body = JSON.parse(text) as typeof body;
  } catch {
    // Cloudflare's bot challenge is an HTML page, usually with HTTP 403.
    throw new LogSourceError(
      /<html|just a moment/i.test(text)
        ? `blocked by a bot challenge (HTTP ${response.status})`
        : `HTTP ${response.status}, not JSON`
    );
  }
  if (Array.isArray(body.result)) return body.result as ExplorerLog[];
  if (body.message === 'No records found') return [];
  const detail =
    typeof body.result === 'string'
      ? body.result
      : typeof body.error === 'string'
        ? body.error
        : body.message;
  throw new LogSourceError(`${detail || 'no log list'} (HTTP ${response.status})`.slice(0, 200));
}

type LogScan = { accounts: Set<Address>; truncated: boolean };

async function scanExplorer(
  source: ExplorerSource,
  gate: Address,
  deadline: number
): Promise<LogScan> {
  const accounts = new Set<Address>();
  let fromBlock = 0n;
  for (let page = 0; page < MAX_LOG_PAGES; page += 1) {
    let logs: ExplorerLog[];
    try {
      logs = await fetchExplorerPage(source, gate, fromBlock, deadline);
    } catch (error) {
      // Out of time after some pages: keep what was read as a partial list.
      if (page > 0 && Date.now() >= deadline) return { accounts, truncated: true };
      throw error;
    }
    for (const log of logs) {
      for (const account of accountsFromGateLog(log)) accounts.add(account);
    }
    if (logs.length < LOG_PAGE_SIZE) return { accounts, truncated: false };
    const lastBlock = logs[logs.length - 1]?.blockNumber;
    if (!lastBlock) return { accounts, truncated: true };
    // A full page can end partway through a block. Restart from that block,
    // not the next one, or its remaining logs are skipped. The set dedupes.
    const next = BigInt(lastBlock);
    if (next <= fromBlock) return { accounts, truncated: true };
    fromBlock = next;
  }
  return { accounts, truncated: true };
}

async function scanRpc(gate: Address, deadline: number): Promise<LogScan> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new LogSourceError('skipped, out of time');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new LogSourceError('timed out')), remaining);
  });
  try {
    const logs = await Promise.race([
      publicClient.getLogs({
        address: gate,
        events: ROSTER_EVENTS,
        fromBlock: 0n,
        toBlock: 'latest',
      }),
      timedOut,
    ]);
    const accounts = new Set<Address>();
    for (const log of logs) {
      for (const account of accountsFromGateLog(log)) accounts.add(account);
    }
    return { accounts, truncated: false };
  } catch (error) {
    if (error instanceof LogSourceError) throw error;
    // RPC errors can embed the keyed URL; keep only a fixed summary.
    throw new LogSourceError('eth_getLogs over the full range was rejected (free RPC plans cap the block span)');
  } finally {
    clearTimeout(timer);
  }
}

/** Runs the source chain once. Exported for tests; callers use `readGateRosterCandidates`. */
export async function scanGateLogs(
  gate: Address,
  budget: GateLookupBudget = DEFAULT_LOOKUP_BUDGET
): Promise<GateRosterCandidates> {
  const deadline = Date.now() + budget.totalMs;
  const explorerDeadline = deadline - budget.rpcReserveMs;
  const failures: string[] = [];
  let partial: Set<Address> | null = null;
  const attempts: Array<{ name: string; run: () => Promise<LogScan> }> = [
    ...explorerSources().map((source) => ({
      name: source.name,
      run: () => scanExplorer(source, gate, explorerDeadline),
    })),
    { name: 'Base RPC', run: () => scanRpc(gate, deadline) },
  ];
  for (const attempt of attempts) {
    try {
      const scan = await attempt.run();
      if (!scan.truncated) return { accounts: [...scan.accounts], status: 'complete' };
      failures.push(`${attempt.name}: incomplete (page limit or out of time)`);
      if (!partial || scan.accounts.size > partial.size) partial = scan.accounts;
    } catch (error) {
      const message = error instanceof LogSourceError ? error.message : 'unexpected error';
      failures.push(`${attempt.name}: ${message}`);
    }
  }
  const hasKey = Boolean(
    process.env.BLOCKSCOUT_API_KEY?.trim() || process.env.ETHERSCAN_API_KEY?.trim()
  );
  const hint = hasKey
    ? ''
    : ' Set BLOCKSCOUT_API_KEY (free at dev.blockscout.com) on the server.';
  const reason = `${failures.join('; ')}.${hint}`;
  logger.warn('Send-assets gate log lookup failed', { gate, reason });
  return { accounts: partial ? [...partial] : [], status: 'failed', reason };
}

export async function readGateRosterCandidates(gate: Address): Promise<GateRosterCandidates> {
  const key = `send-assets-gate-roster:${gate.toLowerCase()}`;
  try {
    // Deduplicates concurrent loads and spares explorer credits for 30s.
    // Failures are cached too: without a key every load would otherwise repeat
    // the doomed explorer + RPC calls, and adding a key needs a redeploy anyway.
    return await withServerResponseCache(key, API_CACHE_MAX_AGE_MS, () => scanGateLogs(gate));
  } catch (error) {
    logger.warn('Send-assets gate log lookup failed', {
      gate,
      error: error instanceof Error ? error : new Error(String(error)),
    });
    return { accounts: [], status: 'failed', reason: 'Log lookup timed out.' };
  }
}
