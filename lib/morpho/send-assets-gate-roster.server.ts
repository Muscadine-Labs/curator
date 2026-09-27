import { decodeEventLog, getAddress, type Address, type Hex } from 'viem';
import { logger } from '@/lib/utils/logger';

/**
 * Accounts a WhitelistSendAssetsGate has ever flagged.
 *
 * The mappings `isWhitelisted` / `isWhitelister` cannot be listed on-chain.
 * The app loads vault activity the same way it should be done here: one indexed
 * query for interactions with a single address (`vaultV2transactions` where
 * `vaultAddress_in` is the vault), not a walk of every block. This gate is not
 * a vault, so Morpho does not index it. Blockscout's address log API is that
 * same lookup — the creation transaction and every later log the contract
 * emitted — and returns the whole set in one response.
 *
 * Logs only nominate candidates. Callers still read the live mappings.
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

/** Blockscout returns at most this many logs per `getLogs` call. */
const LOG_PAGE_SIZE = 1_000;
const MAX_LOG_PAGES = 20;

const BLOCKSCOUT_LOGS = 'https://base.blockscout.com/api';

type ExplorerLog = {
  blockNumber?: string;
  data?: string;
  topics?: Array<string | null>;
};

export type GateRosterStatus = 'complete' | 'failed';

export type GateRosterCandidates = {
  accounts: Address[];
  /** `failed` means the address index did not answer, so only configured accounts are listed. */
  status: GateRosterStatus;
};

const inFlight = new Map<string, Promise<Address[]>>();

function isHexTopic(topic: string | null | undefined): topic is Hex {
  return typeof topic === 'string' && /^0x[0-9a-fA-F]*$/.test(topic);
}

/** Addresses named by one roster log. Ignores the constructor and unknown events. */
export function accountsFromGateLog(log: {
  data?: string | null;
  topics?: Array<string | null> | null;
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

async function fetchGateLogPage(gate: Address, fromBlock: bigint): Promise<ExplorerLog[]> {
  const url = new URL(BLOCKSCOUT_LOGS);
  url.searchParams.set('module', 'logs');
  url.searchParams.set('action', 'getLogs');
  url.searchParams.set('address', gate);
  url.searchParams.set('fromBlock', fromBlock.toString());
  url.searchParams.set('toBlock', 'latest');
  const response = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'muscadine-curator' },
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`Blockscout logs HTTP ${response.status}`);
  }
  const body = (await response.json()) as { status?: string; message?: string; result?: unknown };
  if (!Array.isArray(body.result)) {
    if (body.message === 'No records found') return [];
    throw new Error(
      typeof body.result === 'string' ? body.result : body.message || 'Blockscout logs returned no list'
    );
  }
  return body.result as ExplorerLog[];
}

async function readGateAccounts(gate: Address): Promise<Address[]> {
  const accounts = new Set<Address>();
  let fromBlock = 0n;
  for (let page = 0; page < MAX_LOG_PAGES; page += 1) {
    const logs = await fetchGateLogPage(gate, fromBlock);
    for (const log of logs) {
      for (const account of accountsFromGateLog(log)) accounts.add(account);
    }
    if (logs.length < LOG_PAGE_SIZE) break;
    const lastBlock = logs[logs.length - 1]?.blockNumber;
    if (!lastBlock) break;
    const next = BigInt(lastBlock) + 1n;
    if (next <= fromBlock) break;
    fromBlock = next;
  }
  return [...accounts];
}

export async function readGateRosterCandidates(gate: Address): Promise<GateRosterCandidates> {
  const key = gate.toLowerCase();
  let pending = inFlight.get(key);
  if (!pending) {
    pending = readGateAccounts(gate).finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
  }
  try {
    const accounts = await pending;
    return { accounts, status: 'complete' };
  } catch (error) {
    logger.warn('Send-assets gate log lookup failed', {
      gate,
      error: error instanceof Error ? error : new Error(String(error)),
    });
    return { accounts: [], status: 'failed' };
  }
}
