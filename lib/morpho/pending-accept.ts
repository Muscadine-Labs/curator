import {
  decodeFunctionData,
  encodeFunctionData,
  getAddress,
  keccak256,
  type Address,
  type Hex,
} from 'viem';
import { vaultV2Abi } from '@/lib/onchain/abis';
import type { CapInfo, VaultV2GovernanceResponse } from '@/app/api/vaults/[id]/governance/route';
import type { V2VaultRiskResponse } from '@/app/api/vaults/[id]/risk/route';
import type { VaultV2PendingItem } from '@/app/api/vaults/[id]/pending/route';
import {
  buildAdapterLabelMap,
  capDisplayLabel,
  formatCapRelative,
  formatCapTokenAmount,
} from '@/lib/morpho/v2-cap-format';
import { resolveCapIdData } from '@/lib/morpho/v2-id-data';
import type { TxPreview, TxPreviewChange } from '@/lib/morpho/tx-preview';
import { formatVaultV2FunctionTitle } from '@/lib/morpho/vault-v2-timelocks';

type WriteContractConfig = {
  address: Address;
  abi: typeof vaultV2Abi;
  functionName: string;
  args: readonly unknown[];
};

function writeConfigFromDataHex(
  vaultAddress: Address | string,
  data: Hex
): WriteContractConfig {
  const decoded = decodeFunctionData({ abi: vaultV2Abi, data });
  return {
    address: getAddress(vaultAddress),
    abi: vaultV2Abi,
    functionName: decoded.functionName,
    args: decoded.args,
  };
}

function writeConfigFromPendingItem(
  vaultAddress: Address | string,
  item: VaultV2PendingItem
): WriteContractConfig | null {
  const address = getAddress(vaultAddress);

  if (item.decoded.type === 'IncreaseCap' && item.decoded.idData) {
    const idData = item.decoded.idData as Hex;
    const cap = BigInt(item.decoded.cap);
    if (item.functionName === 'increaseRelativeCap') {
      return {
        address,
        abi: vaultV2Abi,
        functionName: 'increaseRelativeCap',
        args: [idData, cap] as const,
      };
    }
    if (item.functionName === 'increaseAbsoluteCap') {
      return {
        address,
        abi: vaultV2Abi,
        functionName: 'increaseAbsoluteCap',
        args: [idData, cap] as const,
      };
    }
  }

  return null;
}

export function buildPendingAcceptWriteConfig(
  vaultAddress: Address | string,
  item: VaultV2PendingItem
): WriteContractConfig {
  try {
    return writeConfigFromDataHex(vaultAddress, item.data as Hex);
  } catch {
    const fallback = writeConfigFromPendingItem(vaultAddress, item);
    if (fallback) return fallback;
    throw new Error(
      `Could not build accept transaction for ${item.functionName}. Pending calldata may be invalid.`
    );
  }
}

export function buildPendingAcceptCalldata(
  vaultAddress: Address | string,
  item: VaultV2PendingItem
): { to: Address; data: Hex } {
  const config = buildPendingAcceptWriteConfig(vaultAddress, item);
  return {
    to: config.address,
    data: encodeFunctionData({
      abi: vaultV2Abi,
      functionName: config.functionName as never,
      args: config.args as never,
    }),
  };
}

function capKindFromGraphType(type: string): string {
  if (type === 'Adapter') return 'Adapter';
  if (type === 'MarketV1') return 'Market';
  if (type === 'Collateral') return 'Collateral';
  return type;
}

function formatPendingCapValue(
  functionName: string,
  capValue: string,
  assetSymbol: string | null | undefined,
  assetDecimals: number | null | undefined
): string {
  if (functionName === 'increaseRelativeCap' || functionName === 'decreaseRelativeCap') {
    return formatCapRelative(capValue);
  }
  return formatCapTokenAmount(capValue, assetSymbol, assetDecimals);
}

function resolveCurrentCapForPending(
  item: VaultV2PendingItem,
  governance: VaultV2GovernanceResponse | null | undefined,
  risk: V2VaultRiskResponse | null | undefined
): CapInfo | null {
  if (item.decoded.type !== 'IncreaseCap' || !governance?.caps.length) return null;

  const capId = item.decoded.capId?.toLowerCase();
  if (!capId) return null;

  for (const cap of governance.caps) {
    const idData = resolveCapIdData(cap, risk);
    if (!idData) continue;
    try {
      if (keccak256(idData).toLowerCase() === capId) {
        return cap;
      }
    } catch {
      /* skip malformed */
    }
  }

  return null;
}

export function formatPendingCapSummary(input: {
  item: VaultV2PendingItem;
  governance?: VaultV2GovernanceResponse | null;
  risk?: V2VaultRiskResponse | null;
  assetSymbol?: string | null;
  assetDecimals?: number | null;
}): string {
  const { item, governance, risk, assetSymbol, assetDecimals } = input;
  const decoded = item.decoded;

  if (decoded.type !== 'IncreaseCap') {
    return item.summary;
  }

  const adapterLabels = governance ? buildAdapterLabelMap(governance.adapters) : new Map();
  const matchedCap = resolveCurrentCapForPending(item, governance, risk);
  const label = matchedCap
    ? capDisplayLabel(matchedCap, risk, adapterLabels)
    : capKindFromGraphType(decoded.capType);

  const isRelative = item.functionName === 'increaseRelativeCap';
  const capKind = isRelative ? 'Relative cap' : 'Absolute cap';
  const proposed = formatPendingCapValue(
    item.functionName,
    decoded.cap,
    assetSymbol,
    assetDecimals
  );

  if (matchedCap) {
    const currentValue = isRelative ? matchedCap.relativeCap : matchedCap.absoluteCap;
    const current = formatPendingCapValue(
      item.functionName,
      currentValue,
      assetSymbol,
      assetDecimals
    );
    return `${label}: ${capKind} ${current} → ${proposed}`;
  }

  return `${label}: ${capKind} → ${proposed}`;
}

export function buildPendingAcceptPreview(input: {
  item: VaultV2PendingItem;
  vaultAddress: string;
  vaultSymbol?: string | null;
  assetSymbol?: string | null;
  assetDecimals?: number | null;
  governance?: VaultV2GovernanceResponse | null;
  risk?: V2VaultRiskResponse | null;
}): TxPreview {
  const { item, vaultSymbol, assetSymbol, assetDecimals, governance, risk } = input;
  const title = `Accept ${formatVaultV2FunctionTitle(item.functionName)}`;
  const summary = formatPendingCapSummary({
    item,
    governance,
    risk,
    assetSymbol,
    assetDecimals,
  });

  const changes: TxPreviewChange[] = [];

  if (item.decoded.type === 'IncreaseCap') {
    const adapterLabels = governance ? buildAdapterLabelMap(governance.adapters) : new Map();
    const matchedCap = resolveCurrentCapForPending(item, governance, risk);
    const label = matchedCap
      ? capDisplayLabel(matchedCap, risk, adapterLabels)
      : capKindFromGraphType(item.decoded.capType);

    const isRelative = item.functionName === 'increaseRelativeCap';
    const proposed = formatPendingCapValue(
      item.functionName,
      item.decoded.cap,
      assetSymbol,
      assetDecimals
    );

    let before: string | null = null;
    if (matchedCap) {
      const currentValue = isRelative ? matchedCap.relativeCap : matchedCap.absoluteCap;
      before = formatPendingCapValue(
        item.functionName,
        currentValue,
        assetSymbol,
        assetDecimals
      );
    }

    changes.push({
      action: isRelative ? 'increase_relative_cap' : 'increase_absolute_cap',
      label,
      subtitle: isRelative ? 'Relative cap increase' : 'Absolute cap increase',
      before,
      after: proposed,
    });
  } else {
    changes.push({
      action: 'allocate',
      label: formatVaultV2FunctionTitle(item.functionName),
      subtitle: summary,
    });
  }

  return {
    title,
    description: vaultSymbol
      ? `Execute this timelocked ${vaultSymbol} vault change (caps, adapters, roles, fees, …) after the waiting period. Any wallet or multisig may submit the accept transaction.`
      : 'Execute this timelocked vault change after the waiting period. Any wallet or multisig may submit the accept transaction.',
    changes,
    footnote:
      item.status === 'waiting'
        ? 'This action is still waiting for its timelock — execution will revert until executable.'
        : null,
  };
}

export function buildPendingRevokeCalldata(
  vaultAddress: Address | string,
  item: VaultV2PendingItem
): { to: Address; data: Hex } {
  const address = getAddress(vaultAddress);
  return {
    to: address,
    data: encodeFunctionData({
      abi: vaultV2Abi,
      functionName: 'revoke',
      args: [item.data as Hex],
    }),
  };
}

export function buildPendingRevokePreview(input: {
  item: VaultV2PendingItem;
  vaultAddress: string;
  vaultSymbol?: string | null;
  assetSymbol?: string | null;
  assetDecimals?: number | null;
  governance?: VaultV2GovernanceResponse | null;
  risk?: V2VaultRiskResponse | null;
}): TxPreview {
  const { item, vaultSymbol, assetSymbol, assetDecimals, governance, risk } = input;
  const title = `Revoke ${formatVaultV2FunctionTitle(item.functionName)}`;
  const summary = formatPendingCapSummary({
    item,
    governance,
    risk,
    assetSymbol,
    assetDecimals,
  });

  return {
    title,
    description: vaultSymbol
      ? `Cancel this pending ${vaultSymbol} timelock action before it executes. Callable by an on-chain sentinel or curator.`
      : 'Cancel this pending timelock action before it executes. Callable by an on-chain sentinel or curator.',
    changes: [
      {
        action: 'allocate',
        label: formatVaultV2FunctionTitle(item.functionName),
        subtitle: summary,
        before: summary,
        after: 'Cancelled (removed from pending queue)',
      },
    ],
    footnote:
      item.status === 'ready'
        ? 'This action is already executable — revoke quickly if it should not take effect.'
        : null,
  };
}

