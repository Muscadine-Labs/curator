import {
  decodeFunctionData,
  encodeFunctionData,
  getAddress,
  type Address,
  type Hex,
} from 'viem';
import { resolveAssetDecimals } from '@/lib/format/asset-decimals';
import { formatRawTokenAmount } from '@/lib/format/number';
import type { PublicAllocatorChange } from '@/lib/morpho/v2-public-allocator-plan';
import type { TxPreview, TxPreviewChange } from '@/lib/morpho/tx-preview';
import { vaultV2BluePublicAllocatorAbi } from '@/lib/onchain/abis';

function asMarketParams(market: readonly [Address, Address, Address, Address, bigint]) {
  const [loanToken, collateralToken, oracle, irm, lltv] = market;
  return { loanToken, collateralToken, oracle, irm, lltv };
}

type PublicAllocatorCall =
  | { functionName: 'setCanPullFromIdle'; args: readonly [Address, boolean] }
  | {
      functionName: 'setAbsoluteCap';
      args: readonly [Address, Address, ReturnType<typeof asMarketParams>, bigint];
    }
  | {
      functionName: 'setCanPullFromMarket';
      args: readonly [Address, Address, ReturnType<typeof asMarketParams>, boolean];
    }
  | { functionName: 'multicall'; args: readonly [readonly Hex[]] };

function callFor(vault: Address, change: PublicAllocatorChange): PublicAllocatorCall {
  if (change.kind === 'idle') {
    return { functionName: 'setCanPullFromIdle', args: [vault, change.next] };
  }
  if (change.kind === 'absoluteCap') {
    return {
      functionName: 'setAbsoluteCap',
      args: [vault, change.adapter, asMarketParams(change.market), change.next],
    };
  }
  return {
    functionName: 'setCanPullFromMarket',
    args: [vault, change.adapter, asMarketParams(change.market), change.next],
  };
}

/** One Public Allocator call, or `multicall` when several settings change together. */
function updateCall(vault: Address, changes: PublicAllocatorChange[]): PublicAllocatorCall {
  if (changes.length === 0) {
    throw new Error('No Public Allocator changes to send.');
  }
  const target = getAddress(vault);
  if (changes.length === 1) return callFor(target, changes[0]!);
  return {
    functionName: 'multicall',
    args: [
      changes.map((change) =>
        encodeFunctionData({ abi: vaultV2BluePublicAllocatorAbi, ...callFor(target, change) })
      ),
    ],
  };
}

/** Safe calldata for an allocator update. */
export function encodePublicAllocatorUpdate(
  allocator: Address,
  vault: Address,
  changes: PublicAllocatorChange[]
): { to: Address; data: Hex } {
  return {
    to: getAddress(allocator),
    data: encodeFunctionData({
      abi: vaultV2BluePublicAllocatorAbi,
      ...updateCall(vault, changes),
    }),
  };
}

/** `useVaultWrite` config for the same update. */
export function publicAllocatorWriteConfig(
  allocator: Address,
  vault: Address,
  changes: PublicAllocatorChange[]
) {
  return {
    address: getAddress(allocator),
    abi: vaultV2BluePublicAllocatorAbi,
    ...updateCall(vault, changes),
  };
}

function permissionLabel(allowed: boolean): string {
  return allowed ? 'Allowed' : 'Not allowed';
}

function amountLabel(
  raw: bigint,
  symbol: string | null | undefined,
  apiDecimals: number | null | undefined
): string {
  if (!symbol) return `${raw.toString()} raw`;
  const decimals = resolveAssetDecimals(symbol, apiDecimals ?? undefined);
  return `${formatRawTokenAmount(raw, decimals, 2)} ${symbol}`;
}

function previewChangesFromCalldata(
  data: Hex,
  symbol: string | null | undefined,
  apiDecimals: number | null | undefined
): TxPreviewChange[] {
  try {
    const decoded = decodeFunctionData({ abi: vaultV2BluePublicAllocatorAbi, data });
    if (decoded.functionName === 'multicall') {
      const inner = decoded.args[0] as readonly Hex[];
      return inner.flatMap((call) => previewChangesFromCalldata(call, symbol, apiDecimals));
    }
    if (decoded.functionName === 'setCanPullFromIdle') {
      const allowed = Boolean(decoded.args[1]);
      return [
        {
          action: 'config',
          label: 'Allow allocations from idle',
          after: permissionLabel(allowed),
        },
      ];
    }
    if (decoded.functionName === 'setAbsoluteCap') {
      const cap = decoded.args[3] as bigint;
      return [
        {
          action: 'config',
          label: 'Public Allocator cap',
          after: amountLabel(cap, symbol, apiDecimals),
        },
      ];
    }
    if (decoded.functionName === 'setCanPullFromMarket') {
      const allowed = Boolean(decoded.args[3]);
      return [
        {
          action: 'config',
          label: 'Allow deallocation',
          after: permissionLabel(allowed),
        },
      ];
    }
    return [];
  } catch {
    return [];
  }
}

/** Fallback preview when a Safe row targets the Public Allocator and has no stored preview. */
export function buildPublicAllocatorCalldataPreview(input: {
  data: Hex;
  vaultSymbol?: string | null;
  assetDecimals?: number | null;
}): TxPreview {
  const changes = previewChangesFromCalldata(
    input.data,
    input.vaultSymbol,
    input.assetDecimals
  );
  if (changes.length === 0) {
    return {
      title: 'Public Allocator update',
      description: 'Could not decode Public Allocator calldata.',
      changes: [
        {
          action: 'call',
          label: 'Undecoded calldata',
          subtitle: input.data.slice(0, 18),
        },
      ],
    };
  }
  return {
    title: changes.length === 1 ? 'Public Allocator update' : 'Public Allocator updates',
    description: 'Sent to the Blue Public Allocator. Applies immediately.',
    changes,
    footnote:
      changes.length > 1
        ? `${changes.length} settings batched via multicall.`
        : null,
  };
}
