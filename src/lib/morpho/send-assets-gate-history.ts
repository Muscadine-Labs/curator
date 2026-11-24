import { getAddress, type Address, type Hex } from 'viem';

/**
 * Whitelist history already read from the Curator and Allocator Safes.
 *
 * The gate page walks newest executed transactions and stops at these hashes.
 * `recordedAt` is the later execution time. Advance both safes to their newest
 * executed transaction when updating Curator, and add any account a newer gate
 * call names. If a hash is missing, the page reads that Safe's full history.
 */
export type GateHistoryStop = {
  address: Address;
  nonce: number;
  executionDate: string;
  safeTxHash: Hex;
  transactionHash: Hex;
};

export type GateHistoryCheckpoint = {
  gate: Address;
  recordedAt: string;
  accounts: readonly Address[];
  safes: readonly GateHistoryStop[];
};

const account = (value: string) => getAddress(value);

export const GATE_ROSTER_CHECKPOINT: GateHistoryCheckpoint = {
  gate: account('0xb7f2598ac79a3c6406dddb81edcc60ea72a134b9'),
  recordedAt: '2026-10-31T23:34:51Z',
  accounts: [
    '0x2Ed45BB3542d06d81D117acd8A561e910A17A618',
    '0xb6d1d784e9Bc3570546e231caCB52B4E0f1ED8b1',
    '0x8B6E43CCE1961D3671a39Fe8D9E711E69ddD74ce',
    '0x5b211DA4Cd92cfb9CCCFbd1De78289955EB236CD',
    '0xf691616Dd2cF85c9cA9fa32bdFf00f5cD92BAd81',
    '0xa3b90423FD6f70B9f4A424dEBfB27ac502ac1464',
    '0x628037c2D25F5e5f6F90415CFf6d7e8860f41C08',
    '0x057fd8B961Eb664baA647a5C7A6e9728fabA266A',
    '0xf35B121bA32cBeaA27716abEfFb6B65a55f9B333',
    '0x31E70f063cA802DedCd76e74C8F6D730eC43D9f0',
    '0x0D5A708B651FeE1DAA0470431c4262ab3e1D0261',
    '0x48db1f53eA51e37fFE10e59f1df7dC38E52be80e',
    '0x9e284c8Aa44132C911140950D93e44f027199CC5',
    '0xE11EF8eE62a4b395Fd1163036e5412EDa7db0918',
    '0xD437c78a6bA1F42Dca908F3759ab8B8A42Af4D82',
  ].map(account),
  safes: [
    {
      address: account('0xb6d1d784e9Bc3570546e231caCB52B4E0f1ED8b1'),
      nonce: 224,
      executionDate: '2026-10-31T21:40:07Z',
      safeTxHash: '0x146a92f75b2d0fdf23834c020562efa4d06d7c036a8c72dee781b12abf93428f',
      transactionHash: '0x56e720c3e30cb0f90e32e96ba8f34573ca5b219e7f916fb232b485a569f5619c',
    },
    {
      address: account('0x2Ed45BB3542d06d81D117acd8A561e910A17A618'),
      nonce: 148,
      executionDate: '2026-10-31T23:34:51Z',
      safeTxHash: '0xe4e98f18a4efa3973c13fbba1c8e8de95b90cc4e6d1d69e5d02b03ab87c39f8a',
      transactionHash: '0x6a8af91c8a60aef5e681bf587a6dace3608f4c9fbb3fc45d3c2e5a2ff6fceb8e',
    },
  ],
};
