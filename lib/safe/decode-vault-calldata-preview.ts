import { decodeFunctionData, getAddress, type Address, type Hex } from 'viem';
import { vaultV2Abi } from '@/lib/onchain/abis';
import { getVaultByAddress, getVaultAssetSymbol } from '@/lib/config/vaults';
import { formatRawTokenAmount } from '@/lib/format/number';
import { formatCapRelative } from '@/lib/morpho/v2-cap-format';
import { resolveAssetDecimals } from '@/lib/format/asset-decimals';
import type { TxPreview, TxPreviewChange } from '@/lib/morpho/tx-preview';
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

function flattenVaultCalldata(data: Hex): DecodedVaultCall[] {
  const top = decodeSingleVaultCall(data);
  if (!top) return [];

  if (top.functionName === 'multicall') {
    const inner = top.args[0] as readonly Hex[];
    return inner
      .map((callData) => decodeSingleVaultCall(callData))
      .filter((call): call is DecodedVaultCall => call != null);
  }

  return [top];
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
    default:
      return {
        action: 'allocate',
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
  if (name.startsWith('decrease')) return 'Vault cap decrease';
  return 'Vault transaction';
}

function previewFootnote(calls: DecodedVaultCall[]): string | null {
  if (calls.length <= 1) return null;
  return `${calls.length} on-chain calls batched via multicall (decoded from calldata).`;
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
          action: 'allocate',
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

export function resolveVaultAddressFromPending(tx: SafePendingTransaction): Address | null {
  if (tx.source.type === 'allocation' || tx.source.type === 'sentinel') {
    return getAddress(tx.source.vaultAddress);
  }
  if (getVaultByAddress(tx.to)) {
    return getAddress(tx.to);
  }
  return null;
}

export function resolveVaultSymbolFromPending(tx: SafePendingTransaction): string | undefined {
  if (tx.source.type === 'allocation' || tx.source.type === 'sentinel') {
    return tx.source.vaultSymbol;
  }
  const vaultAddress = resolveVaultAddressFromPending(tx);
  if (vaultAddress) {
    return getVaultAssetSymbol(vaultAddress);
  }
  return undefined;
}

/** Stored preview when present; otherwise decode vault calldata for display. */
export function resolveSafePendingPreview(tx: SafePendingTransaction): TxPreview {
  if (tx.preview && tx.preview.changes.length > 0) {
    return tx.preview;
  }

  const vaultAddress = resolveVaultAddressFromPending(tx);
  if (!vaultAddress) {
    return {
      title: 'Safe transaction',
      description: tx.description,
      changes: [
        {
          action: 'allocate',
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

export function inferVaultSourceFromCalldata(
  vaultAddress: Address,
  data: Hex
): SafeTransactionSource {
  const calls = flattenVaultCalldata(data);
  const hasDeallocate = calls.some((c) => c.functionName === 'deallocate');
  const hasCapDecrease = calls.some(
    (c) => c.functionName === 'decreaseAbsoluteCap' || c.functionName === 'decreaseRelativeCap'
  );

  if (hasCapDecrease) {
    return {
      type: 'sentinel',
      action: hasDeallocate ? 'deallocate' : 'decrease_cap',
      vaultAddress: getAddress(vaultAddress),
    };
  }

  if (calls.some((c) => c.functionName === 'allocate' || c.functionName === 'deallocate')) {
    return {
      type: 'allocation',
      vaultAddress: getAddress(vaultAddress),
    };
  }

  return { type: 'manual' };
}
