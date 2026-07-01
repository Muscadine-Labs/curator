import {
  clampDeallocateAmount,
  formatAllocationTableAmount,
  formatCapDisplayAmount,
} from '@/lib/format/allocation-display';
import { capSectionLabel, formatCapRelative } from '@/lib/morpho/v2-cap-format';
import {
  parseCapDecreaseInput,
  type CapDecreaseMode,
} from '@/lib/morpho/cap-decrease-input';
import type { CapInfo } from '@/app/api/vaults/[id]/governance/route';
import { isAdapterCap, isCollateralCap, isMarketCap } from '@/lib/morpho/cap-utils';

export type TxPreviewAction =
  | 'allocate'
  | 'deallocate'
  | 'decrease_absolute_cap'
  | 'decrease_relative_cap'
  | 'increase_absolute_cap'
  | 'increase_relative_cap';

export type TxPreviewChange = {
  action: TxPreviewAction;
  label: string;
  subtitle?: string | null;
  before?: string | null;
  after?: string | null;
  delta?: string | null;
};

export type TxPreview = {
  title: string;
  description?: string | null;
  changes: TxPreviewChange[];
  footnote?: string | null;
};

export type AllocationRebalanceRow = {
  label: string;
  symbol: string;
  decimals: number;
  isVaultIdle?: boolean;
  currentAssets: bigint;
  assets: bigint;
};

function capKindLabel(cap: CapInfo): string {
  if (isAdapterCap(cap)) return 'Adapter cap';
  if (isCollateralCap(cap)) return 'Collateral cap';
  if (isMarketCap(cap)) return 'Market cap';
  return 'Cap';
}

function formatToken(raw: bigint, symbol: string, decimals: number): string {
  return formatAllocationTableAmount(raw, symbol, decimals);
}

export function collectAllocationRebalanceChanges(
  rows: AllocationRebalanceRow[]
): TxPreviewChange[] {
  const changes: TxPreviewChange[] = [];

  for (const row of rows) {
    if (row.isVaultIdle) continue;
    if (row.assets === row.currentAssets) continue;

    const before = formatToken(row.currentAssets, row.symbol, row.decimals);
    const after = formatToken(row.assets, row.symbol, row.decimals);

    if (row.assets < row.currentAssets) {
      const rawDelta =
        row.assets === 0n
          ? row.currentAssets
          : clampDeallocateAmount(row.currentAssets - row.assets, row.currentAssets);
      if (rawDelta <= 0n) continue;
      changes.push({
        action: 'deallocate',
        label: row.label,
        subtitle: 'Move to Idle',
        before,
        after,
        delta: formatToken(rawDelta, row.symbol, row.decimals),
      });
      continue;
    }

    const rawDelta = row.assets - row.currentAssets;
    if (rawDelta <= 0n) continue;
    changes.push({
      action: 'allocate',
      label: row.label,
      subtitle: 'From Idle',
      before,
      after,
      delta: formatToken(rawDelta, row.symbol, row.decimals),
    });
  }

  const deallocs = changes.filter((c) => c.action === 'deallocate');
  const allocs = changes.filter((c) => c.action === 'allocate');
  return [...deallocs, ...allocs];
}

export function buildAllocationRebalancePreview(
  rows: AllocationRebalanceRow[],
  vaultSymbol: string
): TxPreview | null {
  const changes = collectAllocationRebalanceChanges(rows);
  if (changes.length === 0) return null;

  const callCount = changes.length;
  const footnote =
    callCount > 1
      ? `${callCount} on-chain calls batched via multicall (deallocations first, then allocations).`
      : 'Single on-chain call.';

  return {
    title: 'Confirm rebalance',
    description: `Review allocation changes before signing. Amounts are in ${vaultSymbol}.`,
    changes,
    footnote,
  };
}

export type CapDecreasePreviewResult =
  | { ok: true; preview: TxPreview }
  | { ok: false; error: string };

export function buildCapDecreasePreview(input: {
  cap: CapInfo;
  capLabel: string;
  mode: CapDecreaseMode;
  currentAbsoluteRaw: string;
  currentRelativeRaw: string;
  newValueStr: string;
  assetSymbol: string | null | undefined;
  assetDecimals: number | null | undefined;
  chainDecimals: number;
}): CapDecreasePreviewResult {
  const {
    cap,
    capLabel,
    mode,
    currentAbsoluteRaw,
    currentRelativeRaw,
    newValueStr,
    assetSymbol,
    assetDecimals,
    chainDecimals,
  } = input;

  const parsed = parseCapDecreaseInput({
    mode,
    valueStr: newValueStr,
    currentAbsoluteRaw,
    currentRelativeRaw,
    assetSymbol,
    chainDecimals,
  });

  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }

  const kind = capKindLabel(cap);
  const subtitle = `${kind} · ${capSectionLabel(cap)}`;

  if (parsed.mode === 'absolute') {
    const current = BigInt(currentAbsoluteRaw);
    return {
      ok: true,
      preview: {
        title: 'Confirm cap decrease',
        description: 'Absolute cap will be lowered immediately (no timelock).',
        changes: [
          {
            action: 'decrease_absolute_cap',
            label: capLabel,
            subtitle,
            before: formatCapDisplayAmount(current, assetSymbol, assetDecimals ?? chainDecimals),
            after: formatCapDisplayAmount(parsed.value, assetSymbol, assetDecimals ?? chainDecimals),
          },
        ],
      },
    };
  }

  return {
    ok: true,
    preview: {
      title: 'Confirm cap decrease',
      description: 'Relative cap will be lowered immediately (no timelock).',
      changes: [
        {
          action: 'decrease_relative_cap',
          label: capLabel,
          subtitle,
          before: formatCapRelative(currentRelativeRaw),
          after: formatCapRelative(parsed.value.toString()),
        },
      ],
    },
  };
}

export function buildDeallocatePreview(input: {
  label: string;
  lltv?: string | null;
  amountRaw: bigint;
  currentRaw: bigint;
  symbol: string | null | undefined;
  chainDecimals: number;
  assetDecimals?: number | null;
}): TxPreview | null {
  const { label, lltv, amountRaw, currentRaw, symbol, chainDecimals, assetDecimals } = input;
  if (amountRaw <= 0n) return null;

  const decimals = assetDecimals ?? chainDecimals;
  const afterRaw = currentRaw > amountRaw ? currentRaw - amountRaw : 0n;

  return {
    title: 'Confirm deallocate',
    description: 'Funds will move from this position to vault idle cash.',
    changes: [
      {
        action: 'deallocate',
        label,
        subtitle: lltv ? `LLTV ${lltv}` : 'Move to Idle',
        delta: formatToken(amountRaw, symbol ?? '', decimals),
        before: formatToken(currentRaw, symbol ?? '', decimals),
        after: formatToken(afterRaw, symbol ?? '', decimals),
      },
    ],
  };
}

export type DeallocatePreviewResult =
  | { ok: true; preview: TxPreview }
  | { ok: false; error: string };

export function buildDeallocatePreviewResult(input: {
  label: string;
  lltv?: string | null;
  amountRaw: bigint;
  currentRaw: bigint;
  symbol: string | null | undefined;
  chainDecimals: number;
  assetDecimals?: number | null;
}): DeallocatePreviewResult {
  if (input.amountRaw <= 0n) {
    return { ok: false, error: 'Enter an amount greater than zero.' };
  }
  const preview = buildDeallocatePreview(input);
  if (!preview) {
    return { ok: false, error: 'Unable to build deallocate preview.' };
  }
  return { ok: true, preview };
}

export function txPreviewActionLabel(action: TxPreviewAction): string {
  switch (action) {
    case 'allocate':
      return 'Allocate';
    case 'deallocate':
      return 'Deallocate';
    case 'decrease_absolute_cap':
      return 'Decrease absolute cap';
    case 'decrease_relative_cap':
      return 'Decrease relative cap';
    case 'increase_absolute_cap':
      return 'Increase absolute cap';
    case 'increase_relative_cap':
      return 'Increase relative cap';
  }
}
