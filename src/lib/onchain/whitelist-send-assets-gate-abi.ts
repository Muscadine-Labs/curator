/**
 * Morpho Vault V2 periphery — WhitelistSendAssetsGate (ISendAssetsGate).
 * @see https://github.com/morpho-org/vault-v2/tree/main/src/periphery/gates
 */
export const whitelistSendAssetsGateAbi = [
  {
    type: 'function',
    name: 'roleSetter',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'isWhitelister',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'canSendAssets',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'isWhitelisted',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'setRoleSetter',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'newRoleSetter', type: 'address' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'setIsWhitelister',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'newIsWhitelister', type: 'bool' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'setIsWhitelisted',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'newIsWhitelisted', type: 'bool' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'multicall',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'data', type: 'bytes[]' }],
    outputs: [],
  },
] as const;
