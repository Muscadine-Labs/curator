'use client';

import { Address, Hex, encodeFunctionData } from 'viem';
import { vaultV2Abi } from './abis';

export const v2WriteConfigs = {
  allocate: (vaultAddress: Address, adapter: Address, data: Hex, assets: bigint) => ({
    address: vaultAddress,
    abi: vaultV2Abi,
    functionName: 'allocate' as const,
    args: [adapter, data, assets] as const,
  }),

  deallocate: (vaultAddress: Address, adapter: Address, data: Hex, assets: bigint) => ({
    address: vaultAddress,
    abi: vaultV2Abi,
    functionName: 'deallocate' as const,
    args: [adapter, data, assets] as const,
  }),

  increaseAbsoluteCap: (vaultAddress: Address, idData: Hex, newAbsoluteCap: bigint) => ({
    address: vaultAddress,
    abi: vaultV2Abi,
    functionName: 'increaseAbsoluteCap' as const,
    args: [idData, newAbsoluteCap] as const,
  }),

  decreaseAbsoluteCap: (vaultAddress: Address, idData: Hex, newAbsoluteCap: bigint) => ({
    address: vaultAddress,
    abi: vaultV2Abi,
    functionName: 'decreaseAbsoluteCap' as const,
    args: [idData, newAbsoluteCap] as const,
  }),

  increaseRelativeCap: (vaultAddress: Address, idData: Hex, newRelativeCap: bigint) => ({
    address: vaultAddress,
    abi: vaultV2Abi,
    functionName: 'increaseRelativeCap' as const,
    args: [idData, newRelativeCap] as const,
  }),

  decreaseRelativeCap: (vaultAddress: Address, idData: Hex, newRelativeCap: bigint) => ({
    address: vaultAddress,
    abi: vaultV2Abi,
    functionName: 'decreaseRelativeCap' as const,
    args: [idData, newRelativeCap] as const,
  }),

  addAdapter: (vaultAddress: Address, adapter: Address) => ({
    address: vaultAddress,
    abi: vaultV2Abi,
    functionName: 'addAdapter' as const,
    args: [adapter] as const,
  }),

  removeAdapter: (vaultAddress: Address, adapter: Address) => ({
    address: vaultAddress,
    abi: vaultV2Abi,
    functionName: 'removeAdapter' as const,
    args: [adapter] as const,
  }),

  setPerformanceFee: (vaultAddress: Address, newFee: bigint) => ({
    address: vaultAddress,
    abi: vaultV2Abi,
    functionName: 'setPerformanceFee' as const,
    args: [newFee] as const,
  }),

  setManagementFee: (vaultAddress: Address, newFee: bigint) => ({
    address: vaultAddress,
    abi: vaultV2Abi,
    functionName: 'setManagementFee' as const,
    args: [newFee] as const,
  }),

  setMaxRate: (vaultAddress: Address, newMaxRate: bigint) => ({
    address: vaultAddress,
    abi: vaultV2Abi,
    functionName: 'setMaxRate' as const,
    args: [newMaxRate] as const,
  }),

  setLiquidityAdapterAndData: (vaultAddress: Address, liquidityAdapter: Address, liquidityData: Hex) => ({
    address: vaultAddress,
    abi: vaultV2Abi,
    functionName: 'setLiquidityAdapterAndData' as const,
    args: [liquidityAdapter, liquidityData] as const,
  }),

  submit: (vaultAddress: Address, data: Hex) => ({
    address: vaultAddress,
    abi: vaultV2Abi,
    functionName: 'submit' as const,
    args: [data] as const,
  }),

  revoke: (vaultAddress: Address, data: Hex) => ({
    address: vaultAddress,
    abi: vaultV2Abi,
    functionName: 'revoke' as const,
    args: [data] as const,
  }),

  setOwner: (vaultAddress: Address, newOwner: Address) => ({
    address: vaultAddress,
    abi: vaultV2Abi,
    functionName: 'setOwner' as const,
    args: [newOwner] as const,
  }),

  setCurator: (vaultAddress: Address, newCurator: Address) => ({
    address: vaultAddress,
    abi: vaultV2Abi,
    functionName: 'setCurator' as const,
    args: [newCurator] as const,
  }),

  setIsSentinel: (vaultAddress: Address, account: Address, newIsSentinel: boolean) => ({
    address: vaultAddress,
    abi: vaultV2Abi,
    functionName: 'setIsSentinel' as const,
    args: [account, newIsSentinel] as const,
  }),

  setName: (vaultAddress: Address, newName: string) => ({
    address: vaultAddress,
    abi: vaultV2Abi,
    functionName: 'setName' as const,
    args: [newName] as const,
  }),

  setSymbol: (vaultAddress: Address, newSymbol: string) => ({
    address: vaultAddress,
    abi: vaultV2Abi,
    functionName: 'setSymbol' as const,
    args: [newSymbol] as const,
  }),

  multicall: (vaultAddress: Address, calls: Hex[]) => ({
    address: vaultAddress,
    abi: vaultV2Abi,
    functionName: 'multicall' as const,
    args: [calls] as const,
  }),

  encodeAllocate: (adapter: Address, data: Hex, assets: bigint): Hex =>
    encodeFunctionData({ abi: vaultV2Abi, functionName: 'allocate', args: [adapter, data, assets] }),

  encodeDeallocate: (adapter: Address, data: Hex, assets: bigint): Hex =>
    encodeFunctionData({ abi: vaultV2Abi, functionName: 'deallocate', args: [adapter, data, assets] }),
};
