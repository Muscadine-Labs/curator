import type { Address, Hex } from 'viem';
import type { TxPreview } from '@/lib/morpho/tx-preview';
import type { SafeRole } from '@/lib/safe/config';

export type SafeTransactionStatus =
  | 'awaiting_signatures'
  | 'ready'
  | 'executed'
  | 'cancelled'
  | 'stale';

export type SafeTransactionSource =
  | {
      type: 'allocation';
      vaultAddress: Address;
      vaultSymbol?: string;
    }
  | {
      type: 'sentinel';
      action: 'decrease_cap' | 'deallocate';
      vaultAddress: Address;
      vaultSymbol?: string;
    }
  | {
      type: 'caps';
      action: 'accept_pending';
      vaultAddress: Address;
      vaultSymbol?: string;
    }
  | {
      type: 'manual';
    };

export type SafeOwnerSignature = {
  signer: Address;
  data: Hex;
  signedAt: string;
};

/** Off-chain Safe proposal stored in browser localStorage. */
export type SafePendingTransaction = {
  id: string;
  safeRole: SafeRole;
  safeAddress: Address;
  safeTxHash: Hex;
  to: Address;
  value: string;
  data: Hex;
  operation: 0 | 1;
  safeTxGas: string;
  baseGas: string;
  gasPrice: string;
  gasToken: Address;
  refundReceiver: Address;
  nonce: string;
  status: SafeTransactionStatus;
  proposer: Address | null;
  description: string;
  source: SafeTransactionSource;
  preview: TxPreview | null;
  signatures: SafeOwnerSignature[];
  createdAt: string;
  updatedAt: string;
  executedTxHash?: Hex;
  /** Posted to Safe Transaction Service for other owners. */
  serviceSynced?: boolean;
  serviceSyncError?: string | null;
};

export type SafeOnChainInfo = {
  address: Address;
  owners: Address[];
  threshold: number;
  nonce: bigint;
  version: string;
  ethBalance: bigint;
};

/** Transaction Service delegate — can propose txs without being a Safe owner. */
export type SafeProposer = {
  address: Address;
  delegator: Address;
  label: string;
};

export type SafeProposersInfo = {
  proposers: SafeProposer[];
  /** False when `NEXT_PUBLIC_SAFE_API_KEY` is unset — list unavailable from the service. */
  proposersConfigured: boolean;
  proposersError?: string;
};
