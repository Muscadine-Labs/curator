import { gql } from 'graphql-request';
import { formatVaultV2FunctionTitle } from '@/lib/morpho/vault-v2-timelocks';

export const VAULT_V2_PENDING_QUERY = gql`
  query VaultV2Pending($address: String!, $chainId: Int!, $first: Int!) {
    vault: vaultV2ByAddress(address: $address, chainId: $chainId) {
      address
      pendingConfigs(first: $first) {
        items {
          data
          functionName
          txHash
          validAt
          decodedData {
            __typename
            ... on VaultV2AbdicatePendingData {
              functionName
              selector
            }
            ... on VaultV2AdapterPendingData {
              adapterAddress
            }
            ... on VaultV2IncreaseCapPendingData {
              cap
              config {
                id
                idData
                type
              }
            }
            ... on VaultV2SetAdapterRegistryPendingData {
              adapterRegistry
            }
            ... on VaultV2SetForceDeallocatePenaltyPendingData {
              adapterAddress
              forceDeallocatePenalty
            }
            ... on VaultV2SetIsAllocatorPendingData {
              isAllocator
              account {
                address
              }
            }
            ... on VaultV2SetManagementFeePendingData {
              managementFee
            }
            ... on VaultV2SetManagementFeeRecipientPendingData {
              managementFeeRecipient
            }
            ... on VaultV2SetPerformanceFeePendingData {
              performanceFee
            }
            ... on VaultV2SetPerformanceFeeRecipientPendingData {
              performanceFeeRecipient
            }
            ... on VaultV2SetReceiveAssetsGatePendingData {
              receiveAssetsGate
            }
            ... on VaultV2SetReceiveSharesGatePendingData {
              receiveSharesGate
            }
            ... on VaultV2SetSendAssetsGatePendingData {
              sendAssetsGate
            }
            ... on VaultV2SetSendSharesGatePendingData {
              sendSharesGate
            }
            ... on VaultV2TimelockPendingData {
              functionName
              selector
              timelock
            }
          }
        }
      }
    }
  }
`;

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

export function mapPendingDecoded(
  decoded: { __typename?: string | null } & Record<string, unknown> | null | undefined
): VaultV2PendingDecoded {
  if (!decoded?.__typename) return { type: 'Unknown' };

  switch (decoded.__typename) {
    case 'VaultV2AbdicatePendingData':
      return {
        type: 'Abdicate',
        functionName: String(decoded.functionName ?? ''),
        selector: String(decoded.selector ?? ''),
      };
    case 'VaultV2AdapterPendingData':
      return {
        type: 'Adapter',
        adapterAddress: String(decoded.adapterAddress ?? ''),
      };
    case 'VaultV2IncreaseCapPendingData':
      return {
        type: 'IncreaseCap',
        cap: String(decoded.cap ?? '0'),
        capType: String((decoded.config as { type?: string })?.type ?? 'Unknown'),
        capId: String((decoded.config as { id?: string })?.id ?? ''),
        idData: String((decoded.config as { idData?: string })?.idData ?? '') || null,
      };
    case 'VaultV2SetAdapterRegistryPendingData':
      return {
        type: 'SetAdapterRegistry',
        adapterRegistry: String(decoded.adapterRegistry ?? ''),
      };
    case 'VaultV2SetForceDeallocatePenaltyPendingData':
      return {
        type: 'SetForceDeallocatePenalty',
        adapterAddress: String(decoded.adapterAddress ?? ''),
        forceDeallocatePenalty: String(decoded.forceDeallocatePenalty ?? '0'),
      };
    case 'VaultV2SetIsAllocatorPendingData':
      return {
        type: 'SetIsAllocator',
        account: String((decoded.account as { address?: string })?.address ?? ''),
        isAllocator: Boolean(decoded.isAllocator),
      };
    case 'VaultV2SetManagementFeePendingData':
      return {
        type: 'SetManagementFee',
        managementFee: String(decoded.managementFee ?? '0'),
      };
    case 'VaultV2SetManagementFeeRecipientPendingData':
      return {
        type: 'SetManagementFeeRecipient',
        managementFeeRecipient: String(decoded.managementFeeRecipient ?? ''),
      };
    case 'VaultV2SetPerformanceFeePendingData':
      return {
        type: 'SetPerformanceFee',
        performanceFee: String(decoded.performanceFee ?? '0'),
      };
    case 'VaultV2SetPerformanceFeeRecipientPendingData':
      return {
        type: 'SetPerformanceFeeRecipient',
        performanceFeeRecipient: String(decoded.performanceFeeRecipient ?? ''),
      };
    case 'VaultV2SetReceiveAssetsGatePendingData':
      return {
        type: 'SetReceiveAssetsGate',
        receiveAssetsGate: String(decoded.receiveAssetsGate ?? ''),
      };
    case 'VaultV2SetReceiveSharesGatePendingData':
      return {
        type: 'SetReceiveSharesGate',
        receiveSharesGate: String(decoded.receiveSharesGate ?? ''),
      };
    case 'VaultV2SetSendAssetsGatePendingData':
      return {
        type: 'SetSendAssetsGate',
        sendAssetsGate: String(decoded.sendAssetsGate ?? ''),
      };
    case 'VaultV2SetSendSharesGatePendingData':
      return {
        type: 'SetSendSharesGate',
        sendSharesGate: String(decoded.sendSharesGate ?? ''),
      };
    case 'VaultV2TimelockPendingData':
      return {
        type: 'Timelock',
        functionName: String(decoded.functionName ?? ''),
        selector: String(decoded.selector ?? ''),
        timelock: String(decoded.timelock ?? '0'),
      };
    default:
      return { type: 'Unknown' };
  }
}

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
