import { format } from 'date-fns';

/** Curator function descriptions (Morpho Vault V2 timelocks). */
export const VAULT_V2_FUNCTION_DESCRIPTIONS: Record<string, string> = {
  abdicate: 'Permanently disable a curator function so it can never be called again',
  addAdapter: "Add a new adapter to the vault's enabled allocation set",
  decreaseAbsoluteCap: 'Lower the maximum absolute amount allocatable to an allocation',
  decreaseRelativeCap: 'Lower the maximum percentage of vault assets allocatable to an allocation',
  decreaseTimelock: 'Reduce the waiting period before a timelocked change takes effect',
  increaseAbsoluteCap: 'Raise the maximum absolute amount allocatable to an allocation',
  increaseRelativeCap: 'Raise the maximum percentage of vault assets allocatable to an allocation',
  increaseTimelock: 'Increase the waiting period before a timelocked change takes effect',
  removeAdapter: "Remove an adapter from the vault's enabled allocation set",
  setAdapterRegistry: 'Change the registry contract that validates vault adapters',
  setForceDeallocatePenalty: 'Change the penalty applied when force-deallocating from an adapter',
  setIsAllocator: 'Grant or revoke allocator permissions for an address',
  setIsSentinel: 'Grant or revoke sentinel permissions for an address',
  setManagementFee: 'Change the annual fee rate charged continuously on total vault assets',
  setManagementFeeRecipient: 'Change the address that receives management fee payments',
  setPerformanceFee: 'Change the fee rate charged on vault interest, collected at accrual',
  setPerformanceFeeRecipient: 'Change the address that receives performance fee payments',
  setReceiveAssetsGate: 'Change the gate that controls which addresses can receive withdrawn assets',
  setReceiveSharesGate: 'Change the gate that controls which addresses can receive vault shares',
  setSendAssetsGate: 'Change the gate that controls which addresses can deposit assets',
  setSendSharesGate: 'Change the gate that controls which addresses can send vault shares',
  setLiquidityAdapterAndData: 'Change the vault liquidity adapter and its configuration',
  setMaxRate: 'Change the maximum interest rate the vault can charge',
  setOwner: 'Transfer vault ownership to a new address',
  setCurator: 'Change the vault curator address',
};

const VAULT_V2_FUNCTION_TITLES: Record<string, string> = {
  abdicate: 'Abdicate',
  setReceiveSharesGate: 'Set Receive Shares Gate',
  setSendSharesGate: 'Set Send Shares Gate',
  setReceiveAssetsGate: 'Set Receive Assets Gate',
  setSendAssetsGate: 'Set Send Assets Gate',
  setIsAllocator: 'Set Allocator',
  setAdapterRegistry: 'Set Adapter Registry',
  setPerformanceFee: 'Set Performance Fee',
  setManagementFee: 'Set Management Fee',
  increaseAbsoluteCap: 'Increase Absolute Cap',
  increaseRelativeCap: 'Increase Relative Cap',
  decreaseAbsoluteCap: 'Decrease Absolute Cap',
  decreaseRelativeCap: 'Decrease Relative Cap',
  addAdapter: 'Add Adapter',
  removeAdapter: 'Remove Adapter',
};

export function formatVaultV2FunctionTitle(functionName: string): string {
  if (VAULT_V2_FUNCTION_TITLES[functionName]) {
    return VAULT_V2_FUNCTION_TITLES[functionName];
  }
  const spaced = functionName
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function describeVaultV2Function(
  functionName: string,
  abdicatedAt: number | null | undefined = null
): string {
  if (isTimelockAbdicated(abdicatedAt)) {
    return 'Permanently disabled — this curator function can no longer be called';
  }
  return VAULT_V2_FUNCTION_DESCRIPTIONS[functionName] ?? '';
}

export function isTimelockAbdicated(abdicatedAt: number | null | undefined): boolean {
  return abdicatedAt != null && abdicatedAt > 0;
}

export function formatAbdicatedAt(abdicatedAt: number): string {
  return format(new Date(abdicatedAt * 1000), 'MMM d, yyyy');
}

export function formatTimelockDuration(seconds: number): string {
  if (seconds === 0) return 'Instant';
  const days = Math.floor(seconds / 86400);
  if (days >= 1 && seconds % 86400 === 0) return `${days} day${days === 1 ? '' : 's'}`;
  const hours = Math.floor((seconds % 86400) / 3600);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours} hour${hours === 1 ? '' : 's'}`;
  const minutes = Math.floor((seconds % 3600) / 60);
  if (minutes > 0) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  return `${seconds}s`;
}

export type TimelockStatusVariant = 'abdicated' | 'instant' | 'delayed';

export function formatTimelockStatus(
  durationSeconds: number,
  abdicatedAt: number | null | undefined
): { label: string; variant: TimelockStatusVariant } {
  if (isTimelockAbdicated(abdicatedAt)) {
    return { label: 'Abdicated', variant: 'abdicated' };
  }
  if (durationSeconds === 0) {
    return { label: 'Instant', variant: 'instant' };
  }
  return { label: formatTimelockDuration(durationSeconds), variant: 'delayed' };
}
