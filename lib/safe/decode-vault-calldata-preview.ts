import { decodeFunctionData, erc20Abi, getAddress, type Address, type Hex } from 'viem';
import { vaultV2Abi } from '@/lib/onchain/abis';
import { whitelistSendAssetsGateAbi } from '@/lib/onchain/whitelist-send-assets-gate-abi';
import {
  configuredSendAssetsGates,
  resolveAllowlistLabel,
} from '@/lib/config/deposit-gates';
import { getVaultByAddress, getVaultAssetSymbol } from '@/lib/config/vaults';
import { formatRawTokenAmount } from '@/lib/format/number';
import { formatCapRelative } from '@/lib/morpho/v2-cap-format';
import { resolveAssetDecimals } from '@/lib/format/asset-decimals';
import { getDefaultSafeTokens, SAFE_AMOUNT_DP } from '@/lib/safe/tokens';
import type { TxPreview, TxPreviewChange } from '@/lib/morpho/tx-preview';
import { decodeMultiSend, isKnownMultiSend, safeTransactionHazards } from '@/lib/safe/multisend';
import type { SafePendingTransaction, SafeTransactionSource } from '@/lib/safe/types';

type DecodedVaultCall = {
  functionName: string;
  args: readonly unknown[];
};

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function resolveVaultAssetLabel(vaultAddress: Address, vaultSymbol?: string | null): string | undefined {
  if (vaultSymbol?.trim()) return vaultSymbol.trim();
  return getVaultAssetSymbol(vaultAddress);
}

function resolveVaultDecimals(vaultAddress: Address, vaultSymbol?: string | null): number {
  const symbol = resolveVaultAssetLabel(vaultAddress, vaultSymbol);
  return resolveAssetDecimals(symbol, undefined);
}

function decodeSingleVaultCall(data: Hex): DecodedVaultCall | null {
  try {
    const decoded = decodeFunctionData({ abi: vaultV2Abi, data });
    return { functionName: decoded.functionName, args: decoded.args };
  } catch {
    return null;
  }
}

type DecodedGateWrite = {
  action: 'set_whitelisted' | 'set_whitelister';
  account: Address;
  allowed: boolean;
};

export function isConfiguredGateAddress(address: Address): boolean {
  const target = getAddress(address);
  return configuredSendAssetsGates().some((gate) => gate.address === target);
}

function decodeGateWrites(data: Hex): DecodedGateWrite[] {
  try {
    const decoded = decodeFunctionData({ abi: whitelistSendAssetsGateAbi, data });
    if (decoded.functionName === 'setIsWhitelisted' || decoded.functionName === 'setIsWhitelister') {
      return [
        {
          action: decoded.functionName === 'setIsWhitelisted' ? 'set_whitelisted' : 'set_whitelister',
          account: getAddress(decoded.args[0] as Address),
          allowed: Boolean(decoded.args[1]),
        },
      ];
    }
    if (decoded.functionName === 'multicall') {
      const inner = decoded.args[0] as readonly Hex[];
      return inner.flatMap((call) => decodeGateWrites(call));
    }
    return [];
  } catch {
    return [];
  }
}

function inferGateSource(to: Address, data: Hex): SafeTransactionSource | null {
  if (!isConfiguredGateAddress(to)) return null;
  const writes = decodeGateWrites(data);
  return {
    type: 'gate',
    action: writes[0]?.action ?? 'set_whitelisted',
    gateAddress: getAddress(to),
  };
}

function buildGatePreview(to: Address, data: Hex): TxPreview {
  const writes = decodeGateWrites(data);
  if (writes.length === 0) {
    return {
      title: 'Gate update',
      description: `WhitelistSendAssetsGate ${shortAddress(to)}`,
      changes: [
        {
          action: 'gate',
          label: 'Undecoded gate calldata',
          subtitle: `To ${to}`,
        },
      ],
    };
  }

  const first = writes[0]!;
  const title =
    writes.length === 1
      ? `Gate ${first.action === 'set_whitelisted' ? 'allowlist' : 'whitelister'} — ${
          first.allowed ? 'allow' : 'deny'
        } ${shortAddress(first.account)}`
      : `Gate multicall (${writes.length} updates)`;

  return {
    title,
    description: `WhitelistSendAssetsGate ${shortAddress(to)}`,
    changes: writes.map((write) => ({
      action: 'gate' as const,
      label: resolveAllowlistLabel(write.account),
      subtitle: `${
        write.action === 'set_whitelisted' ? 'Depositor allowlist' : 'Whitelister'
      } · ${write.account}`,
      delta: write.allowed ? 'allow' : 'deny',
    })),
  };
}

/** Marker for a call the Vault V2 ABI cannot decode; `args[0]` is its raw calldata. */
const UNDECODED_CALL = '__undecoded';

function decodeOrMark(callData: Hex): DecodedVaultCall {
  return decodeSingleVaultCall(callData) ?? { functionName: UNDECODED_CALL, args: [callData] };
}

/**
 * Every call the vault will execute. Inner calls the Vault V2 ABI cannot
 * decode are kept as markers rather than dropped — a share `transfer` hidden
 * in a `multicall` must still show up in the preview an owner signs.
 */
function flattenVaultCalldata(data: Hex): DecodedVaultCall[] {
  const top = decodeSingleVaultCall(data);
  if (!top) return [];

  if (top.functionName === 'submit') {
    return [decodeOrMark(top.args[0] as Hex)];
  }

  if (top.functionName === 'multicall') {
    const inner = top.args[0] as readonly Hex[];
    return inner.map(decodeOrMark);
  }

  return [top];
}

/** Number of calls inside vault calldata that the Vault V2 ABI cannot decode. */
export function countUndecodedVaultCalls(data: Hex): number {
  return flattenVaultCalldata(data).filter((call) => call.functionName === UNDECODED_CALL)
    .length;
}

function describeUndecodedCall(callData: Hex): TxPreviewChange {
  try {
    const decoded = decodeFunctionData({ abi: erc20Abi, data: callData });
    const args = decoded.args as readonly unknown[];
    const parts = args.map((arg) => (typeof arg === 'bigint' ? arg.toString() : String(arg)));
    return {
      action: 'call',
      label: `ERC-20 ${decoded.functionName}`,
      subtitle: `${parts.join(', ')} (raw units)`,
    };
  } catch {
    return {
      action: 'call',
      label: `Undecoded call ${callData.slice(0, 10)}`,
      subtitle: 'Not a Vault V2 function — review the raw calldata before signing',
    };
  }
}

function formatAmount(raw: bigint, decimals: number, symbol?: string | null): string {
  const amount = formatRawTokenAmount(raw, decimals, 6);
  return symbol?.trim() ? `${amount} ${symbol.trim()}` : `${amount} units`;
}

function changeFromVaultCall(
  call: DecodedVaultCall,
  decimals: number,
  symbol?: string | null
): TxPreviewChange | null {
  switch (call.functionName) {
    case UNDECODED_CALL:
      return describeUndecodedCall(call.args[0] as Hex);
    case 'allocate': {
      const [adapter, , assets] = call.args as [Address, Hex, bigint];
      return {
        action: 'allocate',
        label: `Adapter ${shortAddress(getAddress(adapter))}`,
        subtitle: 'From Idle',
        delta: formatAmount(assets, decimals, symbol),
      };
    }
    case 'deallocate': {
      const [adapter, , assets] = call.args as [Address, Hex, bigint];
      return {
        action: 'deallocate',
        label: `Adapter ${shortAddress(getAddress(adapter))}`,
        subtitle: 'Move to Idle',
        delta: formatAmount(assets, decimals, symbol),
      };
    }
    case 'decreaseAbsoluteCap': {
      const [, newCap] = call.args as [Hex, bigint];
      return {
        action: 'decrease_absolute_cap',
        label: 'Absolute cap',
        after: formatAmount(newCap, decimals, symbol),
      };
    }
    case 'decreaseRelativeCap': {
      const [, newCap] = call.args as [Hex, bigint];
      return {
        action: 'decrease_relative_cap',
        label: 'Relative cap',
        after: formatCapRelative(newCap.toString()),
      };
    }
    case 'increaseAbsoluteCap': {
      const [, newCap] = call.args as [Hex, bigint];
      return {
        action: 'increase_absolute_cap',
        label: 'Absolute cap',
        after: formatAmount(newCap, decimals, symbol),
      };
    }
    case 'increaseRelativeCap': {
      const [, newCap] = call.args as [Hex, bigint];
      return {
        action: 'increase_relative_cap',
        label: 'Relative cap',
        after: formatCapRelative(newCap.toString()),
      };
    }
    case 'revoke':
      return {
        action: 'revoke',
        label: 'Revoke pending timelock action',
        subtitle: 'Cancels queued config before execution',
      };
    default:
      return {
        action: 'config',
        label: call.functionName,
        subtitle: 'Vault write',
      };
  }
}

function previewTitle(calls: DecodedVaultCall[]): string {
  if (calls.length === 0) return 'Vault transaction';
  if (calls.length > 1) return 'Vault batched transaction';
  const name = calls[0]!.functionName;
  if (name === 'allocate' || name === 'deallocate') return 'Vault allocation change';
  if (name === 'revoke') return 'Revoke pending timelock action';
  if (name === 'setLiquidityAdapterAndData') return 'Liquidity adapter change';
  if (name.startsWith('decrease')) return 'Vault cap decrease';
  return 'Vault transaction';
}

function previewFootnote(calls: DecodedVaultCall[]): string | null {
  const undecoded = calls.filter((call) => call.functionName === UNDECODED_CALL).length;
  const undecodedNote =
    undecoded > 0
      ? ` ${undecoded} call${undecoded === 1 ? '' : 's'} could not be decoded as Vault V2 functions.`
      : '';
  if (calls.length <= 1) return undecodedNote.trim() || null;
  return `${calls.length} on-chain calls batched via multicall (decoded from calldata).${undecodedNote}`;
}

/** Build a tx preview from raw vault V2 calldata (for service imports and legacy queue rows). */
export function buildVaultCalldataPreview(input: {
  vaultAddress: Address;
  data: Hex;
  vaultSymbol?: string | null;
}): TxPreview {
  const calls = flattenVaultCalldata(input.data);
  const assetLabel = resolveVaultAssetLabel(input.vaultAddress, input.vaultSymbol);
  const decimals = resolveVaultDecimals(input.vaultAddress, input.vaultSymbol);
  const changes = calls
    .map((call) => changeFromVaultCall(call, decimals, assetLabel))
    .filter((change): change is TxPreviewChange => change != null);

  if (changes.length === 0) {
    return {
      title: 'Vault transaction',
      description: `Target vault ${shortAddress(getAddress(input.vaultAddress))}`,
      changes: [
        {
          action: 'call',
          label: 'Undecoded calldata',
          subtitle: input.data.slice(0, 18),
        },
      ],
      footnote: 'Could not decode vault ABI — showing raw calldata prefix.',
    };
  }

  const deallocs = changes.filter((c) => c.action === 'deallocate');
  const others = changes.filter((c) => c.action !== 'deallocate');

  return {
    title: previewTitle(calls),
    description:
      assetLabel != null
        ? `Decoded from on-chain calldata (${assetLabel} vault).`
        : 'Decoded from on-chain calldata.',
    changes: [...deallocs, ...others],
    footnote: previewFootnote(calls),
  };
}

/**
 * An ERC-20 `transfer` on a token contract. Vault shares are ERC-20s, so a
 * share transfer targets a tracked vault address while being a plain token
 * movement — decoding it as vault calldata would show an owner
 * "Undecoded calldata" instead of who is receiving how much.
 */
function decodeErc20Transfer(data: Hex): { recipient: Address; amount: bigint } | null {
  try {
    const decoded = decodeFunctionData({ abi: erc20Abi, data });
    if (decoded.functionName !== 'transfer') return null;
    const [recipient, amount] = decoded.args as [Address, bigint];
    return { recipient: getAddress(recipient), amount };
  } catch {
    return null;
  }
}

function lookupSafeToken(address: Address): { symbol: string; decimals: number } | null {
  const match = getDefaultSafeTokens().find(
    (t) => String(t.address).toLowerCase() === address.toLowerCase()
  );
  return match ? { symbol: match.symbol, decimals: match.decimals } : null;
}

function buildTransferPreviewFromCalldata(
  token: Address,
  transfer: { recipient: Address; amount: bigint }
): TxPreview {
  const meta = lookupSafeToken(token);
  const amount = meta
    ? `${formatRawTokenAmount(transfer.amount, meta.decimals, SAFE_AMOUNT_DP)} ${meta.symbol}`
    : `${transfer.amount.toString()} raw units`;

  return {
    title: `Send ${amount}`,
    description: `ERC-20 transfer to ${shortAddress(transfer.recipient)}`,
    changes: [
      {
        action: 'withdraw',
        label: meta?.symbol ?? `Token ${shortAddress(token)}`,
        subtitle: `To ${transfer.recipient}`,
        delta: `−${amount}`,
      },
    ],
    footnote: meta
      ? null
      : `Unrecognised token ${token} — amount shown in raw units, decimals unknown.`,
  };
}

export function resolveVaultAddressFromPending(tx: SafePendingTransaction): Address | null {
  if (
    tx.source.type === 'allocation' ||
    tx.source.type === 'sentinel' ||
    tx.source.type === 'caps' ||
    tx.source.type === 'curator'
  ) {
    return getAddress(tx.source.vaultAddress);
  }
  // A share transfer targets the vault contract but is not a vault operation —
  // surfacing a "view vault" link there reads as a rebalance. Check the
  // calldata too, not just the source: a transfer imported from the
  // Transaction Service arrives with source `manual`.
  if (tx.source.type === 'transfer') return null;
  if (decodeErc20Transfer(tx.data)) return null;
  if (getVaultByAddress(tx.to)) {
    return getAddress(tx.to);
  }
  return null;
}

export function resolveVaultSymbolFromPending(tx: SafePendingTransaction): string | undefined {
  if (
    tx.source.type === 'allocation' ||
    tx.source.type === 'sentinel' ||
    tx.source.type === 'caps' ||
    tx.source.type === 'curator'
  ) {
    return tx.source.vaultSymbol;
  }
  const vaultAddress = resolveVaultAddressFromPending(tx);
  if (vaultAddress) {
    return getVaultAssetSymbol(vaultAddress);
  }
  return undefined;
}

/** One preview covering every inner call of a Safe MultiSend batch. */
function buildMultiSendPreview(tx: SafePendingTransaction): TxPreview | null {
  const inner = decodeMultiSend(tx.data);
  if (!inner) return null;
  const changes = inner.flatMap((call) =>
    resolveSafePendingPreview({
      ...tx,
      to: call.to,
      value: call.value.toString(),
      data: call.data,
      operation: call.operation,
      source: { type: 'manual' },
      preview: null,
    }).changes
  );
  return {
    title: `MultiSend batch (${inner.length} calls)`,
    description: 'Decoded from the MultiSend calldata.',
    changes,
  };
}

/** Stored preview when present; otherwise decode vault calldata for display. */
export function resolveSafePendingPreview(tx: SafePendingTransaction): TxPreview {
  if (tx.preview && tx.preview.changes.length > 0) {
    return tx.preview;
  }

  if (tx.operation === 1 && isKnownMultiSend(tx.to)) {
    const batch = buildMultiSendPreview(tx);
    if (batch) return batch;
  }

  const transfer = decodeErc20Transfer(tx.data);
  if (transfer) {
    return buildTransferPreviewFromCalldata(getAddress(tx.to), transfer);
  }

  // Native ETH leaving the Safe carries no calldata at all.
  if ((tx.data === '0x' || tx.data.length <= 2) && BigInt(tx.value || '0') > 0n) {
    const amount = `${formatRawTokenAmount(BigInt(tx.value), 18, SAFE_AMOUNT_DP)} ETH`;
    return {
      title: `Send ${amount}`,
      description: `Native transfer to ${shortAddress(getAddress(tx.to))}`,
      changes: [
        {
          action: 'withdraw',
          label: 'ETH',
          subtitle: `To ${getAddress(tx.to)}`,
          delta: `−${amount}`,
        },
      ],
    };
  }

  if (tx.source.type === 'gate' || isConfiguredGateAddress(getAddress(tx.to))) {
    return buildGatePreview(getAddress(tx.to), tx.data);
  }

  const vaultAddress = resolveVaultAddressFromPending(tx);
  if (!vaultAddress) {
    return {
      title: 'Safe transaction',
      description: tx.description,
      changes: [
        {
          action: 'call',
          label: tx.description,
          subtitle: `To ${shortAddress(getAddress(tx.to))}`,
        },
      ],
    };
  }

  return buildVaultCalldataPreview({
    vaultAddress,
    data: tx.data,
    vaultSymbol: resolveVaultSymbolFromPending(tx),
  });
}

export function withDecodedPendingPreview(tx: SafePendingTransaction): SafePendingTransaction {
  if (tx.preview && tx.preview.changes.length > 0) return tx;
  return { ...tx, preview: resolveSafePendingPreview(tx) };
}

/**
 * Classify a Safe transaction imported from the Transaction Service, where the
 * only evidence is the target and the calldata. Token movements are checked
 * first: a vault-share transfer targets a tracked vault, so vault inference
 * alone would mislabel it.
 */
export function inferSafeTxSource(
  to: Address,
  data: Hex,
  value = '0',
  operation: number = 0
): SafeTransactionSource {
  const target = getAddress(to);
  // A DelegateCall runs the target's code as the Safe; its calldata shape says
  // nothing about what it does, so never label it as a transfer or vault write.
  if (operation !== 0) return { type: 'manual' };

  const transfer = decodeErc20Transfer(data);
  if (transfer) {
    const meta = lookupSafeToken(target);
    return {
      type: 'transfer',
      token: target,
      tokenSymbol: meta?.symbol ?? shortAddress(target),
      recipient: transfer.recipient,
      amount: transfer.amount.toString(),
    };
  }

  if ((data === '0x' || data.length <= 2) && BigInt(value || '0') > 0n) {
    return {
      type: 'transfer',
      token: 'native',
      tokenSymbol: 'ETH',
      recipient: target,
      amount: value,
    };
  }

  const gate = inferGateSource(target, data);
  if (gate) return gate;

  if (!getVaultByAddress(target)) return { type: 'manual' };
  return inferVaultSourceFromCalldata(target, data);
}

/** Human title for a service-imported Safe tx (not "Vault action" for transfers). */
export function describeSafeTxSource(
  source: SafeTransactionSource,
  fallbackTo: string
): string {
  switch (source.type) {
    case 'transfer':
      return `Send ${source.tokenSymbol} → ${shortAddress(source.recipient)}`;
    case 'allocation':
      return source.vaultSymbol
        ? `Vault rebalance — ${source.vaultSymbol}`
        : `Vault rebalance — ${shortAddress(source.vaultAddress)}`;
    case 'sentinel':
      return `Sentinel ${source.action.replace(/_/g, ' ')}`;
    case 'caps':
      return 'Accept pending cap';
    case 'curator':
      return `Curator ${source.action.replace(/_/g, ' ')}`;
    case 'gate':
      return `Gate ${source.action.replace(/_/g, ' ')}`;
    default:
      return `Safe proposal — ${fallbackTo.slice(0, 10)}…`;
  }
}

export function inferVaultSourceFromCalldata(
  vaultAddress: Address,
  data: Hex
): SafeTransactionSource {
  const calls = flattenVaultCalldata(data);
  const vault = getAddress(vaultAddress);

  if (calls.some((c) => c.functionName === 'revoke')) {
    return {
      type: 'sentinel',
      action: 'revoke_pending',
      vaultAddress: vault,
    };
  }

  if (calls.some((c) => c.functionName === 'setLiquidityAdapterAndData')) {
    return {
      type: 'allocation',
      action: 'liquidity_adapter',
      vaultAddress: vault,
    };
  }

  const hasDeallocate = calls.some((c) => c.functionName === 'deallocate');
  const hasCapDecrease = calls.some(
    (c) => c.functionName === 'decreaseAbsoluteCap' || c.functionName === 'decreaseRelativeCap'
  );

  if (hasCapDecrease) {
    return {
      type: 'sentinel',
      action: hasDeallocate ? 'deallocate' : 'decrease_cap',
      vaultAddress: vault,
    };
  }

  if (calls.some((c) => c.functionName === 'allocate' || c.functionName === 'deallocate')) {
    return {
      type: 'allocation',
      vaultAddress: vault,
    };
  }

  return { type: 'manual' };
}

/**
 * Warnings for the queue card, derived from the calldata itself so a stored or
 * imported preview cannot hide them. `blocking` proposals cannot be signed or
 * executed from Curator.
 */
export function safePendingWarnings(tx: SafePendingTransaction): {
  messages: string[];
  blocking: boolean;
} {
  const hazards = safeTransactionHazards(tx);
  const messages = [...hazards.messages];
  if (tx.operation === 0 && getVaultByAddress(tx.to) && !decodeErc20Transfer(tx.data)) {
    const undecoded = countUndecodedVaultCalls(tx.data);
    if (undecoded > 0) {
      messages.push(
        `${undecoded} call${undecoded === 1 ? '' : 's'} in this vault transaction could not be decoded as Vault V2 functions. Review the raw calldata before signing.`
      );
    }
  }
  return { messages, blocking: hazards.blocking };
}
