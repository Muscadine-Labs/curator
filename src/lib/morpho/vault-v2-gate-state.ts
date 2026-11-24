import { getAddress, zeroAddress, type Address } from 'viem';
import { publicClient } from '@/lib/onchain/client';
import { vaultV2Abi } from '@/lib/onchain/abis';
import { isTimelockAbdicated } from '@/lib/morpho/vault-v2-timelocks';
import { logger } from '@/lib/utils/logger';

export type VaultGateKey =
  | 'receiveAssets'
  | 'receiveShares'
  | 'sendShares'
  | 'sendAssets';

export type VaultGateAddresses = Record<VaultGateKey, string | null>;

export type VaultGateStatusVariant = 'abdicated' | 'none' | 'set';

export type VaultGateStatus = {
  key: VaultGateKey;
  label: string;
  description: string;
  address: string | null;
  variant: VaultGateStatusVariant;
  statusLabel: string;
};

const GATE_META: Record<
  VaultGateKey,
  { label: string; description: string; setFunction: string }
> = {
  receiveAssets: {
    label: 'Receive assets gate',
    description: 'Controls which addresses can be withdrawal recipients',
    setFunction: 'setReceiveAssetsGate',
  },
  receiveShares: {
    label: 'Receive shares gate',
    description: 'Controls which addresses can receive shares via transfer',
    setFunction: 'setReceiveSharesGate',
  },
  sendShares: {
    label: 'Send shares gate',
    description: 'Controls which addresses can transfer shares out',
    setFunction: 'setSendSharesGate',
  },
  sendAssets: {
    label: 'Send assets gate',
    description: 'Controls which addresses can deposit assets',
    setFunction: 'setSendAssetsGate',
  },
};

const GATE_ORDER: VaultGateKey[] = [
  'receiveAssets',
  'receiveShares',
  'sendShares',
  'sendAssets',
];

function normalizeGateAddress(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  try {
    const addr = getAddress(value);
    if (addr.toLowerCase() === zeroAddress) return null;
    return addr;
  } catch {
    return null;
  }
}

export function emptyVaultGateAddresses(): VaultGateAddresses {
  return {
    receiveAssets: null,
    receiveShares: null,
    sendShares: null,
    sendAssets: null,
  };
}

export async function fetchVaultV2GateAddresses(
  vaultAddress: string
): Promise<VaultGateAddresses> {
  const empty = emptyVaultGateAddresses();
  let vault: Address;
  try {
    vault = getAddress(vaultAddress);
  } catch {
    return empty;
  }

  try {
    const results = await publicClient.multicall({
      contracts: [
        { address: vault, abi: vaultV2Abi, functionName: 'receiveAssetsGate' },
        { address: vault, abi: vaultV2Abi, functionName: 'receiveSharesGate' },
        { address: vault, abi: vaultV2Abi, functionName: 'sendSharesGate' },
        { address: vault, abi: vaultV2Abi, functionName: 'sendAssetsGate' },
      ],
      allowFailure: true,
    });

    return {
      receiveAssets:
        results[0]?.status === 'success' ? normalizeGateAddress(results[0].result) : null,
      receiveShares:
        results[1]?.status === 'success' ? normalizeGateAddress(results[1].result) : null,
      sendShares:
        results[2]?.status === 'success' ? normalizeGateAddress(results[2].result) : null,
      sendAssets:
        results[3]?.status === 'success' ? normalizeGateAddress(results[3].result) : null,
    };
  } catch (error) {
    logger.warn('Failed to read vault V2 gates', {
      vaultAddress,
      error: error instanceof Error ? error : new Error(String(error)),
    });
    return empty;
  }
}

export function formatVaultGateStatus(
  key: VaultGateKey,
  gateAddress: string | null,
  timelocks: Array<{ functionName: string; abdicatedAt: number | null }>
): VaultGateStatus {
  const meta = GATE_META[key];
  const timelock = timelocks.find((t) => t.functionName === meta.setFunction);
  const abdicated = isTimelockAbdicated(timelock?.abdicatedAt);
  const address = normalizeGateAddress(gateAddress);

  if (abdicated) {
    return {
      key,
      label: meta.label,
      description: meta.description,
      address,
      variant: 'abdicated',
      statusLabel: 'Abdicated',
    };
  }

  if (!address) {
    return {
      key,
      label: meta.label,
      description: meta.description,
      address: null,
      variant: 'none',
      statusLabel: 'None',
    };
  }

  return {
    key,
    label: meta.label,
    description: meta.description,
    address,
    variant: 'set',
    statusLabel: 'Set',
  };
}

export function vaultGateStatuses(
  gates: VaultGateAddresses | null | undefined,
  timelocks: Array<{ functionName: string; abdicatedAt: number | null }>
): VaultGateStatus[] {
  const addrs = gates ?? emptyVaultGateAddresses();
  return GATE_ORDER.map((key) => formatVaultGateStatus(key, addrs[key], timelocks));
}

/** Timelock rows Morpho shows on the fee-wrapper overview. */
export const FEE_WRAPPER_TIMELOCK_FUNCTIONS = [
  'setPerformanceFee',
  'setManagementFee',
  'setPerformanceFeeRecipient',
  'setManagementFeeRecipient',
  'setIsAllocator',
  'abdicate',
] as const;
