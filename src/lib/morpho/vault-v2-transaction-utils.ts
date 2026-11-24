export type VaultV2TxData =
  | {
      __typename: 'VaultV2DepositData';
      onBehalf?: string | null;
      sender?: string | null;
    }
  | {
      __typename: 'VaultV2WithdrawData';
      onBehalf?: string | null;
      receiver?: string | null;
      sender?: string | null;
    }
  | {
      __typename: 'VaultV2TransferData';
      from?: string | null;
      to?: string | null;
    }
  | null
  | undefined;

export function vaultV2TransactionUser(data: VaultV2TxData): string | null {
  if (!data?.__typename) return null;
  switch (data.__typename) {
    case 'VaultV2DepositData':
      return data.onBehalf ?? data.sender ?? null;
    case 'VaultV2WithdrawData':
      return data.onBehalf ?? data.receiver ?? data.sender ?? null;
    case 'VaultV2TransferData':
      return data.to ?? data.from ?? null;
    default:
      return null;
  }
}
