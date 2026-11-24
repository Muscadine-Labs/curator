import { encodeFunctionData, type Address, type Hex } from 'viem';
import type { AllowlistedAddress } from '@/lib/config/deposit-gates';
import { depositGateGateWhitelisters } from '@/lib/config/deposit-gates';
import { vaultV2Abi } from '@/lib/onchain/abis';
import { whitelistSendAssetsGateAbi } from '@/lib/onchain/whitelist-send-assets-gate-abi';

export type VaultGateCalldata = {
  vaultAddress: Address;
  vaultLabel: string;
  gateAddress: Address;
  /** Calldata for Curator Safe → vault.submit(data). */
  submitData: Hex;
  /** Same bytes — call vault with this calldata after timelock (accept). */
  acceptData: Hex;
};

export function encodeSetSendAssetsGateCalldata(gateAddress: Address): Hex {
  return encodeFunctionData({
    abi: vaultV2Abi,
    functionName: 'setSendAssetsGate',
    args: [gateAddress],
  });
}

export function buildVaultSetSendAssetsGateCalldata(
  vaultAddress: Address,
  vaultLabel: string,
  gateAddress: Address
): VaultGateCalldata {
  const acceptData = encodeSetSendAssetsGateCalldata(gateAddress);
  return {
    vaultAddress,
    vaultLabel,
    gateAddress,
    submitData: acceptData,
    acceptData,
  };
}

export function encodeGateSetIsWhitelisted(account: Address, allowed = true): Hex {
  return encodeFunctionData({
    abi: whitelistSendAssetsGateAbi,
    functionName: 'setIsWhitelisted',
    args: [account, allowed],
  });
}

export function encodeGateSetIsWhitelister(account: Address, allowed = true): Hex {
  return encodeFunctionData({
    abi: whitelistSendAssetsGateAbi,
    functionName: 'setIsWhitelister',
    args: [account, allowed],
  });
}

/** Batch gate setup: appoint gate whitelisters, then allowlist deposit senders. */
export function encodeGateWhitelistMulticall(allowlist: readonly AllowlistedAddress[]): Hex {
  const calls = [
    ...depositGateGateWhitelisters().map((row) => encodeGateSetIsWhitelister(row.address, true)),
    ...allowlist.map((row) => encodeGateSetIsWhitelisted(row.address, true)),
  ];
  return encodeFunctionData({
    abi: whitelistSendAssetsGateAbi,
    functionName: 'multicall',
    args: [calls],
  });
}

/** Curator Safe (roleSetter) → gate.setIsWhitelister(account, allowed). */
export function encodeGateAppointWhitelisterCalldata(account: Address, allowed = true): Hex {
  return encodeGateSetIsWhitelister(account, allowed);
}

export function encodeVaultSubmitCalldata(innerCalldata: Hex): Hex {
  return encodeFunctionData({
    abi: vaultV2Abi,
    functionName: 'submit',
    args: [innerCalldata],
  });
}
