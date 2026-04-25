/**
 * Circle Cross-Chain Transfer Protocol (CCTP) constants — V1 (legacy) + V2.
 *
 * Canonical USDC burn on source chain → attestation from Circle → mint on destination chain.
 *
 * V1 addresses: https://developers.circle.com/stablecoins/evm-smart-contracts
 * V2 addresses: https://developers.circle.com/cctp/references/contract-addresses
 * Migration guide: https://developers.circle.com/cctp/migration-from-v1-to-v2
 */

import type { Address } from 'viem';

export type CctpVersion = 'v1' | 'v2';

export type TransferSpeed = 'fast' | 'standard';

/**
 * V2 finality thresholds passed to `depositForBurn`.
 * 1000 = Fast Transfer (~seconds), 2000 = Standard Transfer (~minutes).
 */
export const FINALITY_THRESHOLD = {
  fast: 1000,
  standard: 2000,
} as const;

export interface CctpChain {
  /**
   * EVM chain id (e.g. 1, 8453). `0` for non-EVM chains (e.g. Solana) where
   * the wagmi config doesn't have a corresponding EVM network.
   */
  chainId: number;
  /** Human readable name. */
  name: string;
  /** Short explorer name, e.g. "Etherscan". */
  scanName: string;
  /** Block explorer base URL (no trailing slash). */
  scanUrl: string;
  /** CCTP domain id — the opaque destination identifier used by depositForBurn. */
  domain: number;
  /**
   * Whether this chain is EVM-compatible. EVM chains can be used as source via
   * wagmi; non-EVM chains (Solana) require a different wallet / SDK.
   */
  isEvm: boolean;
  /**
   * Which CCTP protocol version(s) are deployed on this chain.
   * - `'v1'` → legacy slow attestation.
   * - `'v2'` → new TokenMessengerV2 / MessageTransmitterV2 with fees + finality.
   * - `'v1+v2'` → both versions deployed.
   */
  cctpVersion: 'v1' | 'v2' | 'v1+v2';
  /**
   * If set, transfers involving this chain are not yet supported by this app
   * and the UI will show this reason. The chain is still listed so operators
   * can reference domains/addresses from the selector.
   */
  disabledReason?: string;
  /** Canonical native USDC token on this chain. Undefined for non-EVM. */
  usdc?: Address;

  // --- V1 contracts (legacy) ---
  /** CCTP V1 TokenMessenger — the contract users call to burn USDC. */
  tokenMessenger?: Address;
  /** CCTP V1 MessageTransmitter — the contract used on destination to receive the mint message. */
  messageTransmitter?: Address;

  // --- V2 contracts ---
  /** CCTP V2 TokenMessengerV2 — deployed at the same address on all EVM chains via CREATE2. */
  tokenMessengerV2?: Address;
  /** CCTP V2 MessageTransmitterV2 — deployed at the same address on all EVM chains via CREATE2. */
  messageTransmitterV2?: Address;
}

/**
 * V2 contract addresses — same on every EVM chain via CREATE2.
 */
const V2_TOKEN_MESSENGER: Address = '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d';
const V2_MESSAGE_TRANSMITTER: Address = '0x81D40F21F12A8F0E3252Bccb954D722d4c464B64';

/**
 * Supported CCTP chains (mainnet).
 *
 * The first six entries support both V1 and V2. HyperEVM is V2-only but now
 * fully wired up (requires V2 mode). Solana is listed for reference only.
 *
 * V2 contracts are deployed at the same CREATE2 address on every EVM chain.
 */
export const CCTP_CHAINS: ReadonlyArray<CctpChain> = [
  {
    chainId: 1,
    name: 'Ethereum',
    scanName: 'Etherscan',
    scanUrl: 'https://etherscan.io',
    domain: 0,
    isEvm: true,
    cctpVersion: 'v1+v2',
    usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    tokenMessenger: '0xBd3fa81B58Ba92a82136038B25aDec7066af3155',
    messageTransmitter: '0x0a992d191DEeC32aFe36203Ad87D7d289a738F81',
    tokenMessengerV2: V2_TOKEN_MESSENGER,
    messageTransmitterV2: V2_MESSAGE_TRANSMITTER,
  },
  {
    chainId: 43114,
    name: 'Avalanche',
    scanName: 'Snowtrace',
    scanUrl: 'https://snowtrace.io',
    domain: 1,
    isEvm: true,
    cctpVersion: 'v1+v2',
    usdc: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
    tokenMessenger: '0x6B25532e1060CE10cc3B0A99e5683b91BFDe6982',
    messageTransmitter: '0x8186359aF5F57FbB40c6b14A588d2A59C0C29880',
    tokenMessengerV2: V2_TOKEN_MESSENGER,
    messageTransmitterV2: V2_MESSAGE_TRANSMITTER,
  },
  {
    chainId: 10,
    name: 'Optimism',
    scanName: 'Optimistic Etherscan',
    scanUrl: 'https://optimistic.etherscan.io',
    domain: 2,
    isEvm: true,
    cctpVersion: 'v1+v2',
    usdc: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
    tokenMessenger: '0x2B4069517957735bE00ceE0fadAE88a26365528f',
    messageTransmitter: '0x4D41f22c5a0e5c74090899E5a8Fb597a8842b3e8',
    tokenMessengerV2: V2_TOKEN_MESSENGER,
    messageTransmitterV2: V2_MESSAGE_TRANSMITTER,
  },
  {
    chainId: 42161,
    name: 'Arbitrum',
    scanName: 'Arbiscan',
    scanUrl: 'https://arbiscan.io',
    domain: 3,
    isEvm: true,
    cctpVersion: 'v1+v2',
    usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    tokenMessenger: '0x19330d10D9Cc8751218eaf51E8885D058642E08A',
    messageTransmitter: '0xC30362313FBBA5cf9163F0bb16a547b25dA88a0c',
    tokenMessengerV2: V2_TOKEN_MESSENGER,
    messageTransmitterV2: V2_MESSAGE_TRANSMITTER,
  },
  {
    chainId: 8453,
    name: 'Base',
    scanName: 'Basescan',
    scanUrl: 'https://basescan.org',
    domain: 6,
    isEvm: true,
    cctpVersion: 'v1+v2',
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    tokenMessenger: '0x1682Ae6375C4E4A97e4B583BC394c861A46D8962',
    messageTransmitter: '0xAD09780d193884d503182aD4588450C416D6F9D4',
    tokenMessengerV2: V2_TOKEN_MESSENGER,
    messageTransmitterV2: V2_MESSAGE_TRANSMITTER,
  },
  {
    chainId: 137,
    name: 'Polygon',
    scanName: 'Polygonscan',
    scanUrl: 'https://polygonscan.com',
    domain: 7,
    isEvm: true,
    cctpVersion: 'v1+v2',
    usdc: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    tokenMessenger: '0x9daF8c91AEFAE50b9c0E69629D3F6Ca40cA3B3FE',
    messageTransmitter: '0xF3be9355363857F3e001be68856A2f96b4C39Ba9',
    tokenMessengerV2: V2_TOKEN_MESSENGER,
    messageTransmitterV2: V2_MESSAGE_TRANSMITTER,
  },
  {
    // Hyperliquid EVM mainnet — V2-only. Fully supported when using V2 mode.
    // V1 mode will show a disabled warning since there are no V1 contracts here.
    chainId: 999,
    name: 'HyperEVM',
    scanName: 'HyperEVMScan',
    scanUrl: 'https://hyperevmscan.io',
    domain: 19,
    isEvm: true,
    cctpVersion: 'v2',
    usdc: '0xb88339CB7199b77E23DB6E890353E22632Ba630f',
    tokenMessengerV2: V2_TOKEN_MESSENGER,
    messageTransmitterV2: V2_MESSAGE_TRANSMITTER,
  },
  {
    // Solana — non-EVM. Listed so operators can see Circle's registry but
    // disabled because signing requires a Solana wallet (e.g. Phantom) and the
    // Solana program IDs are different from the EVM contract addresses.
    chainId: 0,
    name: 'Solana',
    scanName: 'Solana Explorer',
    scanUrl: 'https://explorer.solana.com',
    domain: 5,
    isEvm: false,
    cctpVersion: 'v1+v2',
    disabledReason:
      'Solana is non-EVM and requires a Solana wallet + program-specific tooling. Not yet supported in this app.',
  },
];

export function getCctpChainById(chainId: number): CctpChain | undefined {
  return CCTP_CHAINS.find((c) => c.chainId === chainId);
}

export function getCctpChainByDomain(domain: number): CctpChain | undefined {
  return CCTP_CHAINS.find((c) => c.domain === domain);
}

/** True if transfers from/to this chain are currently unsupported (non-EVM, etc). */
export function isChainDisabled(chain: CctpChain): boolean {
  return Boolean(chain.disabledReason);
}

/**
 * True if the chain can only be used in V2 mode (no V1 contracts deployed).
 */
export function isV2Only(chain: CctpChain): boolean {
  return chain.cctpVersion === 'v2';
}

/**
 * True if the given chain supports the requested CCTP version.
 */
export function chainSupportsVersion(chain: CctpChain, version: CctpVersion): boolean {
  if (version === 'v1') return chain.cctpVersion === 'v1' || chain.cctpVersion === 'v1+v2';
  return chain.cctpVersion === 'v2' || chain.cctpVersion === 'v1+v2';
}

/**
 * Return the token messenger address for a given version. Undefined when
 * the chain doesn't have that version's contract.
 */
export function getTokenMessenger(chain: CctpChain, version: CctpVersion): Address | undefined {
  return version === 'v2' ? chain.tokenMessengerV2 : chain.tokenMessenger;
}

/**
 * Return the message transmitter address for a given version.
 */
export function getMessageTransmitter(chain: CctpChain, version: CctpVersion): Address | undefined {
  return version === 'v2' ? chain.messageTransmitterV2 : chain.messageTransmitter;
}

// ---------------------------------------------------------------------------
// ABIs
// ---------------------------------------------------------------------------

/**
 * V1 TokenMessenger ABI — only the functions we call / events we read.
 */
export const TOKEN_MESSENGER_ABI = [
  {
    type: 'function',
    name: 'depositForBurn',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'destinationDomain', type: 'uint32' },
      { name: 'mintRecipient', type: 'bytes32' },
      { name: 'burnToken', type: 'address' },
    ],
    outputs: [{ name: '_nonce', type: 'uint64' }],
  },
] as const;

/**
 * V2 TokenMessengerV2 ABI — depositForBurn now takes 7 params.
 * https://developers.circle.com/cctp/references/contract-interfaces#depositforburn
 */
export const TOKEN_MESSENGER_V2_ABI = [
  {
    type: 'function',
    name: 'depositForBurn',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'destinationDomain', type: 'uint32' },
      { name: 'mintRecipient', type: 'bytes32' },
      { name: 'burnToken', type: 'address' },
      { name: 'destinationCaller', type: 'bytes32' },
      { name: 'maxFee', type: 'uint256' },
      { name: 'minFinalityThreshold', type: 'uint32' },
    ],
    outputs: [],
  },
] as const;

/**
 * V1 MessageTransmitter ABI — receiveMessage + MessageSent event for extraction.
 */
export const MESSAGE_TRANSMITTER_ABI = [
  {
    type: 'function',
    name: 'receiveMessage',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'message', type: 'bytes' },
      { name: 'attestation', type: 'bytes' },
    ],
    outputs: [{ name: 'success', type: 'bool' }],
  },
  {
    type: 'event',
    name: 'MessageSent',
    anonymous: false,
    inputs: [{ name: 'message', type: 'bytes', indexed: false }],
  },
  {
    type: 'function',
    name: 'usedNonces',
    stateMutability: 'view',
    inputs: [{ name: 'key', type: 'bytes32' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

/**
 * V2 MessageTransmitterV2 ABI — receiveMessage signature is unchanged.
 */
export const MESSAGE_TRANSMITTER_V2_ABI = [
  {
    type: 'function',
    name: 'receiveMessage',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'message', type: 'bytes' },
      { name: 'attestation', type: 'bytes' },
    ],
    outputs: [{ name: 'success', type: 'bool' }],
  },
] as const;

/**
 * Minimal ERC-20 ABI for allowance/approve/decimals/balanceOf.
 */
export const ERC20_ABI = [
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
] as const;

/** USDC is always 6 decimals on the chains CCTP supports. */
export const USDC_DECIMALS = 6;

// ---------------------------------------------------------------------------
// API URLs
// ---------------------------------------------------------------------------

/**
 * Circle attestation API V1 (legacy). Poll `GET /attestations/{messageHash}`.
 */
export const CIRCLE_ATTESTATION_API = 'https://iris-api.circle.com/attestations';

/**
 * Circle CCTP V2 API base. Endpoints:
 *  - `GET /v2/messages/{sourceDomainId}?transactionHash={hash}` — message + attestation
 *  - `GET /v2/burn/USDC/fees/{sourceDomainId}/{destDomainId}` — fee estimate
 *  - `GET /v2/fastBurn/USDC/allowance` — remaining Fast Transfer capacity
 */
export const CIRCLE_API_V2_BASE = 'https://iris-api.circle.com';
