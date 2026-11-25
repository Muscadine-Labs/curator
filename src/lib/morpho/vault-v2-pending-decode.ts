import {
  decodeAbiParameters,
  decodeFunctionData,
  keccak256,
  toFunctionSelector,
  type AbiFunction,
  type Hex,
} from 'viem';
import { vaultV2Abi } from '@/lib/onchain/abis';
import type { VaultV2PendingDecoded } from '@/lib/morpho/vault-v2-api';

/** Vault V2 function name for a 4-byte selector (abdicate / timelock changes name one). */
const FUNCTION_BY_SELECTOR = new Map<string, string>(
  (vaultV2Abi as readonly { type: string }[])
    .filter((item): item is AbiFunction => item.type === 'function')
    .map((fn) => [toFunctionSelector(fn).toLowerCase(), fn.name])
);

export function vaultV2FunctionNameForSelector(selector: string): string {
  return FUNCTION_BY_SELECTOR.get(selector.toLowerCase()) ?? selector;
}

/**
 * Cap kind from cap idData (`abi.encode(string, …)`): `"this"` → Adapter,
 * `"collateralToken"` → Collateral, `"this/marketParams"` → MarketV1. Same
 * values Morpho GraphQL used for `VaultV2CapType`.
 */
export function capTypeFromIdData(idData: Hex): string {
  try {
    const [tag] = decodeAbiParameters([{ type: 'string' }], idData);
    if (tag === 'this') return 'Adapter';
    if (tag === 'collateralToken') return 'Collateral';
    if (tag === 'this/marketParams') return 'MarketV1';
  } catch {
    /* not a cap idData */
  }
  return 'Unknown';
}

export type DecodedPendingCall = {
  functionName: string;
  decoded: VaultV2PendingDecoded;
};

/**
 * Decode the calldata a curator submitted (from the vault's `Submit` event).
 * Replaces Morpho GraphQL `pendingConfigs.decodedData`, which loses
 * `IncreaseCap.cap` and `data` on 2026-12-02.
 */
export function decodePendingCall(data: Hex): DecodedPendingCall | null {
  let call: { functionName: string; args?: readonly unknown[] };
  try {
    call = decodeFunctionData({ abi: vaultV2Abi, data }) as typeof call;
  } catch {
    return null;
  }
  const args = call.args ?? [];
  const str = (i: number) => String(args[i] ?? '');
  const functionName = call.functionName;

  switch (functionName) {
    case 'abdicate':
      return {
        functionName,
        decoded: {
          type: 'Abdicate',
          selector: str(0),
          functionName: vaultV2FunctionNameForSelector(str(0)),
        },
      };
    case 'addAdapter':
    case 'removeAdapter':
      return { functionName, decoded: { type: 'Adapter', adapterAddress: str(0) } };
    case 'increaseAbsoluteCap':
    case 'increaseRelativeCap': {
      const idData = args[0] as Hex;
      return {
        functionName,
        decoded: {
          type: 'IncreaseCap',
          cap: str(1),
          capType: capTypeFromIdData(idData),
          capId: keccak256(idData),
          idData,
        },
      };
    }
    case 'setAdapterRegistry':
      return { functionName, decoded: { type: 'SetAdapterRegistry', adapterRegistry: str(0) } };
    case 'setForceDeallocatePenalty':
      return {
        functionName,
        decoded: {
          type: 'SetForceDeallocatePenalty',
          adapterAddress: str(0),
          forceDeallocatePenalty: str(1),
        },
      };
    case 'setIsAllocator':
      return {
        functionName,
        decoded: { type: 'SetIsAllocator', account: str(0), isAllocator: Boolean(args[1]) },
      };
    case 'setManagementFee':
      return { functionName, decoded: { type: 'SetManagementFee', managementFee: str(0) } };
    case 'setManagementFeeRecipient':
      return {
        functionName,
        decoded: { type: 'SetManagementFeeRecipient', managementFeeRecipient: str(0) },
      };
    case 'setPerformanceFee':
      return { functionName, decoded: { type: 'SetPerformanceFee', performanceFee: str(0) } };
    case 'setPerformanceFeeRecipient':
      return {
        functionName,
        decoded: { type: 'SetPerformanceFeeRecipient', performanceFeeRecipient: str(0) },
      };
    case 'setReceiveAssetsGate':
      return { functionName, decoded: { type: 'SetReceiveAssetsGate', receiveAssetsGate: str(0) } };
    case 'setReceiveSharesGate':
      return { functionName, decoded: { type: 'SetReceiveSharesGate', receiveSharesGate: str(0) } };
    case 'setSendAssetsGate':
      return { functionName, decoded: { type: 'SetSendAssetsGate', sendAssetsGate: str(0) } };
    case 'setSendSharesGate':
      return { functionName, decoded: { type: 'SetSendSharesGate', sendSharesGate: str(0) } };
    case 'increaseTimelock':
    case 'decreaseTimelock':
      return {
        functionName,
        decoded: {
          type: 'Timelock',
          selector: str(0),
          functionName: vaultV2FunctionNameForSelector(str(0)),
          timelock: str(1),
        },
      };
    default:
      return { functionName, decoded: { type: 'Unknown' } };
  }
}
