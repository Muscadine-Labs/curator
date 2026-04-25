/**
 * Circle Cross-Chain Transfer Protocol (CCTP) V2 constants.
 *
 * Canonical USDC burn on source chain → attestation from Circle → mint on destination chain.
 *
 * V2 addresses: https://developers.circle.com/cctp/references/contract-addresses
 */

import type { Address } from 'viem';

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
  /** EVM chain id (e.g. 1, 8453). `0` for non-EVM chains (Solana). */
  chainId: number;
  /** Human readable name. */
  name: string;
  /** Short explorer name, e.g. "Etherscan". */
  scanName: string;
  /** Block explorer base URL (no trailing slash). */
  scanUrl: string;
  /** CCTP domain id — the opaque destination identifier used by depositForBurn. */
  domain: number;
  /** Whether this chain is EVM-compatible. */
  isEvm: boolean;
  /**
   * If set, transfers involving this chain are not yet supported by this app
   * and the UI will show this reason.
   */
  disabledReason?: string;
  /** Canonical native USDC token on this chain. Undefined for non-EVM. */
  usdc?: Address;
  /** CCTP V2 TokenMessengerV2 — deployed at the same address on all EVM chains via CREATE2. */
  tokenMessenger?: Address;
  /** CCTP V2 MessageTransmitterV2 — deployed at the same address on all EVM chains via CREATE2. */
  messageTransmitter?: Address;
}

/**
 * V2 contract addresses — same on every EVM chain via CREATE2.
 */
const V2_TOKEN_MESSENGER: Address = '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d';
const V2_MESSAGE_TRANSMITTER: Address = '0x81D40F21F12A8F0E3252Bccb954D722d4c464B64';

/**
 * Supported CCTP chains (mainnet, V2 only).
 *
 * V2 contracts are deployed at the same CREATE2 address on every EVM chain.
 * Solana is listed for reference only (non-EVM, not yet supported).
 */
export const CCTP_CHAINS: ReadonlyArray<CctpChain> = [
  {
    chainId: 1,
    name: 'Ethereum',
    scanName: 'Etherscan',
    scanUrl: 'https://etherscan.io',
    domain: 0,
    isEvm: true,
    usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    tokenMessenger: V2_TOKEN_MESSENGER,
    messageTransmitter: V2_MESSAGE_TRANSMITTER,
  },
  {
    chainId: 43114,
    name: 'Avalanche',
    scanName: 'Snowtrace',
    scanUrl: 'https://snowtrace.io',
    domain: 1,
    isEvm: true,
    usdc: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
    tokenMessenger: V2_TOKEN_MESSENGER,
    messageTransmitter: V2_MESSAGE_TRANSMITTER,
  },
  {
    chainId: 10,
    name: 'Optimism',
    scanName: 'Optimistic Etherscan',
    scanUrl: 'https://optimistic.etherscan.io',
    domain: 2,
    isEvm: true,
    usdc: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
    tokenMessenger: V2_TOKEN_MESSENGER,
    messageTransmitter: V2_MESSAGE_TRANSMITTER,
  },
  {
    chainId: 42161,
    name: 'Arbitrum',
    scanName: 'Arbiscan',
    scanUrl: 'https://arbiscan.io',
    domain: 3,
    isEvm: true,
    usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    tokenMessenger: V2_TOKEN_MESSENGER,
    messageTransmitter: V2_MESSAGE_TRANSMITTER,
  },
  {
    chainId: 8453,
    name: 'Base',
    scanName: 'Basescan',
    scanUrl: 'https://basescan.org',
    domain: 6,
    isEvm: true,
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    tokenMessenger: V2_TOKEN_MESSENGER,
    messageTransmitter: V2_MESSAGE_TRANSMITTER,
  },
  {
    chainId: 137,
    name: 'Polygon',
    scanName: 'Polygonscan',
    scanUrl: 'https://polygonscan.com',
    domain: 7,
    isEvm: true,
    usdc: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    tokenMessenger: V2_TOKEN_MESSENGER,
    messageTransmitter: V2_MESSAGE_TRANSMITTER,
  },
  {
    chainId: 999,
    name: 'HyperEVM',
    scanName: 'HyperEVMScan',
    scanUrl: 'https://hyperevmscan.io',
    domain: 19,
    isEvm: true,
    usdc: '0xb88339CB7199b77E23DB6E890353E22632Ba630f',
    tokenMessenger: V2_TOKEN_MESSENGER,
    messageTransmitter: V2_MESSAGE_TRANSMITTER,
  },
  {
    chainId: 0,
    name: 'Solana',
    scanName: 'Solana Explorer',
    scanUrl: 'https://explorer.solana.com',
    domain: 5,
    isEvm: false,
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

// ---------------------------------------------------------------------------
// ABIs
// ---------------------------------------------------------------------------

/**
 * V2 TokenMessengerV2 ABI — depositForBurn takes 7 params.
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
 * V2 MessageTransmitterV2 ABI — receiveMessage.
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
 * Circle CCTP V2 API base. Endpoints:
 *  - `GET /v2/messages/{sourceDomainId}?transactionHash={hash}` — message + attestation
 *  - `GET /v2/burn/USDC/fees/{sourceDomainId}/{destDomainId}` — fee estimate
 *  - `GET /v2/fastBurn/USDC/allowance` — remaining Fast Transfer capacity
 */
export const CIRCLE_API_V2_BASE = 'https://iris-api.circle.com';
