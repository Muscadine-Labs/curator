import {
  decodeFunctionData,
  getAddress,
  isAddress,
  parseEventLogs,
  type Address,
  type Hex,
  type TransactionReceipt,
} from 'viem';
import { morphoOracleFactoryAbi } from '@/lib/morpho/blue-create-market';

export type SafeTxBuilderTransaction = {
  to: string;
  value: string;
  data: string;
};

export type SafeTxBuilderBatch = {
  version?: string;
  chainId: string;
  meta?: {
    name?: string;
    description?: string;
    createdFromSafeAddress?: string;
  };
  transactions: SafeTxBuilderTransaction[];
};

export type ParsedOracleDeployTx = {
  factory: Address;
  value: bigint;
  data: Hex;
  args: {
    baseVault: Address;
    baseVaultConversionSample: bigint;
    baseFeed1: Address;
    baseFeed2: Address;
    baseTokenDecimals: bigint;
    quoteVault: Address;
    quoteVaultConversionSample: bigint;
    quoteFeed1: Address;
    quoteFeed2: Address;
    quoteTokenDecimals: bigint;
    salt: Hex;
  };
  chainId: number;
  source: 'safe-tx-builder';
};

export type ParseOraclePayloadResult =
  | { ok: true; tx: ParsedOracleDeployTx }
  | { ok: false; error: string };

export type ParseOraclePayloadOptions = {
  /** Selected create-market chain (must match payload.chainId). */
  expectedChainId: number;
  /** MorphoChainlinkOracleV2Factory on that chain. */
  expectedFactory: Address;
  networkName?: string;
};

function asSafeTx(raw: unknown): SafeTxBuilderTransaction | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.to !== 'string') return null;
  if (typeof obj.data !== 'string') return null;
  return {
    to: obj.to,
    value: typeof obj.value === 'string' || typeof obj.value === 'number' ? String(obj.value) : '0',
    data: obj.data,
  };
}

function asBatch(raw: unknown): SafeTxBuilderBatch | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.chainId !== 'string' && typeof obj.chainId !== 'number') return null;
  if (!Array.isArray(obj.transactions) || obj.transactions.length === 0) return null;
  const transactions: SafeTxBuilderTransaction[] = [];
  for (const entry of obj.transactions) {
    const tx = asSafeTx(entry);
    if (!tx) return null;
    transactions.push(tx);
  }
  return {
    version: typeof obj.version === 'string' ? obj.version : undefined,
    chainId: String(obj.chainId),
    meta: obj.meta as SafeTxBuilderBatch['meta'],
    transactions,
  };
}

/**
 * Parse Gnosis Safe Transaction Builder JSON exported from oracles.morpho.dev.
 * Expects a single createMorphoChainlinkOracleV2 call on the selected chain.
 */
export function parseOracleSafePayload(
  raw: string,
  options: ParseOraclePayloadOptions
): ParseOraclePayloadResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, error: 'Paste the Gnosis Safe payload JSON from the Oracle Portal.' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    return { ok: false, error: 'Invalid JSON — copy the full Safe payload from the portal.' };
  }

  const batch = asBatch(parsed);
  if (!batch) {
    return {
      ok: false,
      error: 'Unrecognized format. Expected Safe Transaction Builder JSON with transactions[].',
    };
  }

  const chainId = Number(batch.chainId);
  if (chainId !== options.expectedChainId) {
    const label = options.networkName ?? `chain ${options.expectedChainId}`;
    return {
      ok: false,
      error: `Payload chainId is ${batch.chainId}; selected network is ${label} (${options.expectedChainId}). Flip the top-bar network or re-export from the portal.`,
    };
  }

  if (batch.transactions.length !== 1) {
    return {
      ok: false,
      error: `Expected exactly 1 transaction in the batch (got ${batch.transactions.length}).`,
    };
  }

  const tx = batch.transactions[0]!;
  if (!isAddress(tx.to)) {
    return { ok: false, error: 'Transaction `to` is not a valid address.' };
  }
  if (typeof tx.data !== 'string' || !tx.data.startsWith('0x')) {
    return { ok: false, error: 'Transaction `data` must be hex calldata.' };
  }

  const factory = getAddress(tx.to) as Address;
  if (factory.toLowerCase() !== options.expectedFactory.toLowerCase()) {
    return {
      ok: false,
      error: `Unexpected factory ${factory}. Expected MorphoChainlinkOracleV2Factory ${options.expectedFactory}.`,
    };
  }

  let decoded;
  try {
    decoded = decodeFunctionData({
      abi: morphoOracleFactoryAbi,
      data: tx.data as Hex,
    });
  } catch {
    return {
      ok: false,
      error: 'Could not decode calldata as createMorphoChainlinkOracleV2.',
    };
  }

  if (decoded.functionName !== 'createMorphoChainlinkOracleV2') {
    return {
      ok: false,
      error: `Unexpected function ${decoded.functionName}; expected createMorphoChainlinkOracleV2.`,
    };
  }

  const args = decoded.args as readonly [
    Address,
    bigint,
    Address,
    Address,
    bigint,
    Address,
    bigint,
    Address,
    Address,
    bigint,
    Hex,
  ];

  let value = 0n;
  try {
    value = BigInt(tx.value || '0');
  } catch {
    return { ok: false, error: 'Invalid transaction value.' };
  }

  return {
    ok: true,
    tx: {
      factory,
      value,
      data: tx.data as Hex,
      chainId,
      source: 'safe-tx-builder',
      args: {
        baseVault: args[0],
        baseVaultConversionSample: args[1],
        baseFeed1: args[2],
        baseFeed2: args[3],
        baseTokenDecimals: args[4],
        quoteVault: args[5],
        quoteVaultConversionSample: args[6],
        quoteFeed1: args[7],
        quoteFeed2: args[8],
        quoteTokenDecimals: args[9],
        salt: args[10],
      },
    },
  };
}

/** Pull deployed oracle address from CreateMorphoChainlinkOracleV2 logs. */
export function oracleAddressFromReceipt(receipt: TransactionReceipt): Address | null {
  try {
    const logs = parseEventLogs({
      abi: morphoOracleFactoryAbi,
      logs: receipt.logs,
      eventName: 'CreateMorphoChainlinkOracleV2',
    });
    const oracle = logs[0]?.args?.oracle;
    if (oracle && isAddress(oracle)) return getAddress(oracle) as Address;
  } catch {
    /* fall through */
  }
  return null;
}
