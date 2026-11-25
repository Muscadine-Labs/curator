import { formatVaultV2FunctionTitle } from '@/lib/morpho/vault-v2-timelocks';

/** WAD-scaled bigint fee from Morpho pending decoded fields. */
export function wadBigIntToPercent(wad: string | number | bigint): string {
  try {
    const scaled = BigInt(wad);
    const percent = Number(scaled) / 1e16;
    return `${percent.toFixed(2)}%`;
  } catch {
    return String(wad);
  }
}

export function formatRelativeCapWad(relativeCap: string): string {
  try {
    const scaled = BigInt(relativeCap);
    const percent = Number(scaled) / 1e16;
    return `${percent.toFixed(2)}%`;
  } catch {
    return relativeCap;
  }
}

import { SECONDS_PER_YEAR } from '@/lib/constants';
export function formatMaxRateApr(
  maxRate: string | number | bigint | null | undefined
): string {
  if (maxRate == null || maxRate === '') return '—';
  try {
    const perSecond = BigInt(maxRate);
    const aprScaled = perSecond * BigInt(SECONDS_PER_YEAR);
    const percent = Number(aprScaled) / 1e16;
    return `${percent.toFixed(2)}%`;
  } catch {
    return '—';
  }
}

/** WAD-scaled force-deallocate penalty (0–2% max on-chain). */
export function formatForceDeallocatePenaltyWad(
  wad: string | number | bigint | null | undefined
): string {
  if (wad == null || wad === '') return '0%';
  try {
    const scaled = BigInt(wad);
    if (scaled === 0n) return '0%';
    const percent = Number(scaled) / 1e16;
    if (percent >= 0.01) return `${percent.toFixed(2)}%`;
    return `${percent.toFixed(4)}%`;
  } catch {
    return String(wad);
  }
}

export type VaultV2PendingDecoded =
  | { type: 'Abdicate'; functionName: string; selector: string }
  | { type: 'Adapter'; adapterAddress: string }
  | { type: 'IncreaseCap'; cap: string; capType: string; capId: string; idData?: string | null }
  | { type: 'SetAdapterRegistry'; adapterRegistry: string }
  | { type: 'SetForceDeallocatePenalty'; adapterAddress: string; forceDeallocatePenalty: string }
  | { type: 'SetIsAllocator'; account: string; isAllocator: boolean }
  | { type: 'SetManagementFee'; managementFee: string }
  | { type: 'SetManagementFeeRecipient'; managementFeeRecipient: string }
  | { type: 'SetPerformanceFee'; performanceFee: string }
  | { type: 'SetPerformanceFeeRecipient'; performanceFeeRecipient: string }
  | { type: 'SetReceiveAssetsGate'; receiveAssetsGate: string }
  | { type: 'SetReceiveSharesGate'; receiveSharesGate: string }
  | { type: 'SetSendAssetsGate'; sendAssetsGate: string }
  | { type: 'SetSendSharesGate'; sendSharesGate: string }
  | { type: 'Timelock'; functionName: string; selector: string; timelock: string }
  | { type: 'Unknown' };

export function describePendingDecoded(decoded: VaultV2PendingDecoded): string {
  switch (decoded.type) {
    case 'Abdicate':
      return `Abdicate ${formatVaultV2FunctionTitle(decoded.functionName)} — permanently disable this function`;
    case 'Adapter':
      return `Adapter ${decoded.adapterAddress}`;
    case 'IncreaseCap':
      return `${decoded.capType} cap increase (awaiting timelock)`;
    case 'SetAdapterRegistry':
      return `Registry ${decoded.adapterRegistry}`;
    case 'SetForceDeallocatePenalty':
      return `Force penalty → ${formatForceDeallocatePenaltyWad(decoded.forceDeallocatePenalty)} on ${decoded.adapterAddress}`;
    case 'SetIsAllocator':
      return `${decoded.isAllocator ? 'Grant' : 'Revoke'} allocator ${decoded.account}`;
    case 'SetManagementFee':
      return `Management fee → ${wadBigIntToPercent(decoded.managementFee)}`;
    case 'SetManagementFeeRecipient':
      return `Mgmt recipient → ${decoded.managementFeeRecipient}`;
    case 'SetPerformanceFee':
      return `Performance fee → ${wadBigIntToPercent(decoded.performanceFee)}`;
    case 'SetPerformanceFeeRecipient':
      return `Perf recipient → ${decoded.performanceFeeRecipient}`;
    case 'SetReceiveAssetsGate':
      return `Receive assets gate → ${decoded.receiveAssetsGate}`;
    case 'SetReceiveSharesGate':
      return `Receive shares gate → ${decoded.receiveSharesGate}`;
    case 'SetSendAssetsGate':
      return `Send assets gate → ${decoded.sendAssetsGate}`;
    case 'SetSendSharesGate':
      return `Send shares gate → ${decoded.sendSharesGate}`;
    case 'Timelock':
      return `Timelock ${decoded.functionName} → ${Number(decoded.timelock)}s`;
    default:
      return 'Pending change';
  }
}
