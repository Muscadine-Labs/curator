/**
 * Circle Cross-Chain Transfer Protocol (CCTP V1) constants.
 *
 * Canonical USDC burn on source chain → attestation from Circle → mint on destination chain.
 * Addresses pulled from https://developers.circle.com/stablecoins/evm-smart-contracts
 * and https://developers.circle.com/cctp/references/contract-addresses
 */

import type { Address } from 'viem';

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
   * - `'v1'` → legacy slow attestation, the flow implemented in this app.
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
  /** CCTP TokenMessenger — the contract users call to burn USDC. */
  tokenMessenger?: Address;
  /** CCTP MessageTransmitter — the contract used on destination to receive the mint message. */
  messageTransmitter?: Address;
}

/**
 * Supported CCTP chains (mainnet).
 *
 * The first six entries are the V1-native chains this app supports end-to-end
 * via wagmi + Circle's V1 attestation API. HyperEVM and Solana are listed per
 * Circle's official registry
 * (https://developers.circle.com/cctp/concepts/supported-chains-and-domains)
 * but flagged as disabled because they require V2 flow / non-EVM tooling which
 * isn't wired up here yet.
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
  },
  {
    // Hyperliquid EVM mainnet. Circle only deployed CCTP V2 here — this app's
    // transfer flow is V1, so we list the chain (for reference) and flag it.
    chainId: 999,
    name: 'HyperEVM',
    scanName: 'HyperEVMScan',
    scanUrl: 'https://hyperevmscan.io',
    domain: 19,
    isEvm: true,
    cctpVersion: 'v2',
    disabledReason:
      'HyperEVM is CCTP V2-only. Transfers require the V2 flow (fees + finality), which is not yet wired up in this app.',
    usdc: '0xb88339CB7199b77E23DB6E890353E22632Ba630f',
    tokenMessenger: '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d',
    messageTransmitter: '0x81D40F21F12A8F0E3252Bccb954D722d4c464B64',
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

/** True if transfers from/to this chain are currently unsupported. */
export function isChainDisabled(chain: CctpChain): boolean {
  return Boolean(chain.disabledReason);
}

/**
 * TokenMessenger ABI — only the functions we call / events we read.
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
 * MessageTransmitter ABI — receiveMessage + MessageSent event for extraction.
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

/**
 * Circle attestation API (production). Poll until status === 'complete'.
 * https://developers.circle.com/stablecoins/docs/cctp-technical-reference#attestation-service-api
 */
export const CIRCLE_ATTESTATION_API = 'https://iris-api.circle.com/attestations';
