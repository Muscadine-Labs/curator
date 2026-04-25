/**
 * @jest-environment node
 *
 * Tests for `lib/cctp/constants.ts`.
 *
 * Goals:
 * - Domain ids match Circle's official registry.
 * - Every "enabled" chain has a complete contract triple (USDC,
 *   TokenMessenger, MessageTransmitter) so the transfer flow can run.
 * - Disabled chains expose a `disabledReason` that the UI surfaces.
 * - Lookup helpers (`getCctpChainById`, `getCctpChainByDomain`,
 *   `isChainDisabled`) behave as expected.
 */

import { type Address } from 'viem';

/**
 * Format-only address validity (not EIP-55 checksum). Some of the addresses
 * in the registry came from Circle docs in mixed case that doesn't satisfy
 * viem's strict checksum, but they're still valid 20-byte hex addresses
 * that the contracts accept.
 */
function isHexAddress(value: string | undefined): value is Address {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value);
}
import {
  CCTP_CHAINS,
  USDC_DECIMALS,
  CIRCLE_ATTESTATION_API,
  CIRCLE_API_V2_BASE,
  ERC20_ABI,
  FINALITY_THRESHOLD,
  TOKEN_MESSENGER_ABI,
  TOKEN_MESSENGER_V2_ABI,
  MESSAGE_TRANSMITTER_ABI,
  MESSAGE_TRANSMITTER_V2_ABI,
  getCctpChainById,
  getCctpChainByDomain,
  isChainDisabled,
  isV2Only,
  chainSupportsVersion,
  getTokenMessenger,
  getMessageTransmitter,
} from '../constants';

// Source of truth: https://developers.circle.com/cctp/concepts/supported-chains-and-domains
const EXPECTED_DOMAINS: Record<string, number> = {
  Ethereum: 0,
  Avalanche: 1,
  Optimism: 2,
  Arbitrum: 3,
  Solana: 5,
  Base: 6,
  Polygon: 7,
  HyperEVM: 19,
};

describe('CCTP_CHAINS registry', () => {
  test('contains the expected set of named chains', () => {
    const names = CCTP_CHAINS.map((c) => c.name).sort();
    expect(names).toEqual(
      ['Arbitrum', 'Avalanche', 'Base', 'Ethereum', 'HyperEVM', 'Optimism', 'Polygon', 'Solana'].sort()
    );
  });

  test('every chain has the correct CCTP domain id per Circle registry', () => {
    for (const chain of CCTP_CHAINS) {
      const expected = EXPECTED_DOMAINS[chain.name];
      expect(expected).toBeDefined();
      expect(chain.domain).toBe(expected);
    }
  });

  test('domain ids are unique', () => {
    const domains = CCTP_CHAINS.map((c) => c.domain);
    expect(new Set(domains).size).toBe(domains.length);
  });

  test('chain ids are unique except for non-EVM placeholders (chainId 0)', () => {
    const evmChains = CCTP_CHAINS.filter((c) => c.isEvm);
    const ids = evmChains.map((c) => c.chainId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('every enabled EVM chain has USDC + at least one version of TokenMessenger + MessageTransmitter', () => {
    const enabledEvm = CCTP_CHAINS.filter((c) => c.isEvm && !isChainDisabled(c));
    expect(enabledEvm.length).toBeGreaterThan(0);
    for (const c of enabledEvm) {
      expect(c.usdc).toBeDefined();
      expect(isHexAddress(c.usdc)).toBe(true);

      // Must have at least one version's contracts
      const hasV1 = c.tokenMessenger && c.messageTransmitter;
      const hasV2 = c.tokenMessengerV2 && c.messageTransmitterV2;
      expect(hasV1 || hasV2).toBeTruthy();

      if (c.tokenMessenger) expect(isHexAddress(c.tokenMessenger)).toBe(true);
      if (c.messageTransmitter) expect(isHexAddress(c.messageTransmitter)).toBe(true);
      if (c.tokenMessengerV2) expect(isHexAddress(c.tokenMessengerV2)).toBe(true);
      if (c.messageTransmitterV2) expect(isHexAddress(c.messageTransmitterV2)).toBe(true);
    }
  });

  test('every disabled chain has a non-empty disabledReason (Solana only)', () => {
    const disabled = CCTP_CHAINS.filter((c) => isChainDisabled(c));
    expect(disabled.length).toBe(1);
    expect(disabled[0].name).toBe('Solana');
    for (const c of disabled) {
      expect(c.disabledReason).toBeTruthy();
      expect((c.disabledReason ?? '').length).toBeGreaterThan(10);
    }
  });

  test('Solana is marked non-EVM, others EVM', () => {
    const solana = CCTP_CHAINS.find((c) => c.name === 'Solana');
    expect(solana?.isEvm).toBe(false);
    const evmCount = CCTP_CHAINS.filter((c) => c.isEvm).length;
    expect(evmCount).toBe(CCTP_CHAINS.length - 1);
  });

  test('HyperEVM is V2-only and not disabled', () => {
    const hyper = CCTP_CHAINS.find((c) => c.name === 'HyperEVM');
    expect(hyper?.cctpVersion).toBe('v2');
    expect(isV2Only(hyper!)).toBe(true);
    expect(isChainDisabled(hyper!)).toBe(false);
  });

  test('every EVM chain with V2 support has V2 contract addresses', () => {
    const v2Chains = CCTP_CHAINS.filter((c) => c.isEvm && chainSupportsVersion(c, 'v2'));
    expect(v2Chains.length).toBeGreaterThan(0);
    for (const c of v2Chains) {
      expect(c.tokenMessengerV2).toBeDefined();
      expect(c.messageTransmitterV2).toBeDefined();
      expect(isHexAddress(c.tokenMessengerV2)).toBe(true);
      expect(isHexAddress(c.messageTransmitterV2)).toBe(true);
    }
  });

  test('V2 contracts have the same CREATE2 address on all EVM chains', () => {
    const v2Chains = CCTP_CHAINS.filter((c) => c.isEvm && c.tokenMessengerV2);
    const messengerAddrs = new Set(v2Chains.map((c) => c.tokenMessengerV2?.toLowerCase()));
    const transmitterAddrs = new Set(v2Chains.map((c) => c.messageTransmitterV2?.toLowerCase()));
    expect(messengerAddrs.size).toBe(1);
    expect(transmitterAddrs.size).toBe(1);
  });

  test('USDC_DECIMALS is the standard 6', () => {
    expect(USDC_DECIMALS).toBe(6);
  });

  test('CIRCLE_ATTESTATION_API points at iris-api', () => {
    expect(CIRCLE_ATTESTATION_API.startsWith('https://iris-api.circle.com')).toBe(true);
  });

  test('CIRCLE_API_V2_BASE points at iris-api', () => {
    expect(CIRCLE_API_V2_BASE.startsWith('https://iris-api.circle.com')).toBe(true);
  });

  test('FINALITY_THRESHOLD has correct fast and standard values', () => {
    expect(FINALITY_THRESHOLD.fast).toBe(1000);
    expect(FINALITY_THRESHOLD.standard).toBe(2000);
  });

  test('V1 ABI exports include the functions/events the app calls', () => {
    const erc20Names = ERC20_ABI.map((e) => e.name);
    expect(erc20Names).toEqual(expect.arrayContaining(['allowance', 'approve', 'balanceOf', 'decimals']));

    const messengerNames = TOKEN_MESSENGER_ABI.map((e) => e.name);
    expect(messengerNames).toContain('depositForBurn');

    const mtNames = MESSAGE_TRANSMITTER_ABI.map((e) => e.name);
    expect(mtNames).toContain('receiveMessage');
    expect(mtNames).toContain('MessageSent');
  });

  test('V2 ABI exports include the V2 depositForBurn with 7 params', () => {
    const v2Messenger = TOKEN_MESSENGER_V2_ABI.find((e) => 'name' in e && e.name === 'depositForBurn');
    expect(v2Messenger).toBeDefined();
    if (v2Messenger && 'inputs' in v2Messenger) {
      expect(v2Messenger.inputs).toHaveLength(7);
      const paramNames = v2Messenger.inputs.map((i) => i.name);
      expect(paramNames).toEqual([
        'amount', 'destinationDomain', 'mintRecipient', 'burnToken',
        'destinationCaller', 'maxFee', 'minFinalityThreshold',
      ]);
    }
  });

  test('V2 MessageTransmitter ABI has receiveMessage', () => {
    const v2Mt = MESSAGE_TRANSMITTER_V2_ABI.find((e) => 'name' in e && e.name === 'receiveMessage');
    expect(v2Mt).toBeDefined();
  });
});

describe('lookup helpers', () => {
  test('getCctpChainById finds known chain', () => {
    const base = getCctpChainById(8453);
    expect(base?.name).toBe('Base');
    expect(getCctpChainById(99_999)).toBeUndefined();
  });

  test('getCctpChainByDomain finds known chain', () => {
    expect(getCctpChainByDomain(0)?.name).toBe('Ethereum');
    expect(getCctpChainByDomain(6)?.name).toBe('Base');
    expect(getCctpChainByDomain(19)?.name).toBe('HyperEVM');
    expect(getCctpChainByDomain(5)?.name).toBe('Solana');
    expect(getCctpChainByDomain(99_999)).toBeUndefined();
  });

  test('isChainDisabled returns true only for chains with a disabledReason', () => {
    const enabled = getCctpChainById(8453)!;
    expect(isChainDisabled(enabled)).toBe(false);
    const solana = CCTP_CHAINS.find((c) => c.name === 'Solana')!;
    expect(isChainDisabled(solana)).toBe(true);
  });

  test('isV2Only returns true only for HyperEVM', () => {
    expect(isV2Only(getCctpChainById(999)!)).toBe(true);
    expect(isV2Only(getCctpChainById(8453)!)).toBe(false);
  });

  test('chainSupportsVersion correctly identifies version support', () => {
    const base = getCctpChainById(8453)!;
    expect(chainSupportsVersion(base, 'v1')).toBe(true);
    expect(chainSupportsVersion(base, 'v2')).toBe(true);

    const hyper = getCctpChainById(999)!;
    expect(chainSupportsVersion(hyper, 'v1')).toBe(false);
    expect(chainSupportsVersion(hyper, 'v2')).toBe(true);
  });

  test('getTokenMessenger returns correct address for each version', () => {
    const base = getCctpChainById(8453)!;
    expect(getTokenMessenger(base, 'v1')).toBe(base.tokenMessenger);
    expect(getTokenMessenger(base, 'v2')).toBe(base.tokenMessengerV2);

    const hyper = getCctpChainById(999)!;
    expect(getTokenMessenger(hyper, 'v1')).toBeUndefined();
    expect(getTokenMessenger(hyper, 'v2')).toBeDefined();
  });

  test('getMessageTransmitter returns correct address for each version', () => {
    const eth = getCctpChainById(1)!;
    expect(getMessageTransmitter(eth, 'v1')).toBe(eth.messageTransmitter);
    expect(getMessageTransmitter(eth, 'v2')).toBe(eth.messageTransmitterV2);
  });
});
