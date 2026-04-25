/**
 * @jest-environment node
 *
 * Tests for `lib/cctp/constants.ts` (V2 only).
 *
 * Goals:
 * - Domain ids match Circle's official registry.
 * - Every "enabled" chain has V2 contracts (TokenMessenger, MessageTransmitter, USDC).
 * - Disabled chains expose a `disabledReason` that the UI surfaces.
 * - Lookup helpers behave as expected.
 */

import { type Address } from 'viem';

function isHexAddress(value: string | undefined): value is Address {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value);
}

import {
  CCTP_CHAINS,
  USDC_DECIMALS,
  CIRCLE_API_V2_BASE,
  ERC20_ABI,
  FINALITY_THRESHOLD,
  TOKEN_MESSENGER_V2_ABI,
  MESSAGE_TRANSMITTER_V2_ABI,
  getCctpChainById,
  getCctpChainByDomain,
  isChainDisabled,
} from '../constants';

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

  test('every enabled EVM chain has USDC + TokenMessenger + MessageTransmitter', () => {
    const enabledEvm = CCTP_CHAINS.filter((c) => c.isEvm && !isChainDisabled(c));
    expect(enabledEvm.length).toBeGreaterThan(0);
    for (const c of enabledEvm) {
      expect(c.usdc).toBeDefined();
      expect(isHexAddress(c.usdc)).toBe(true);
      expect(c.tokenMessenger).toBeDefined();
      expect(isHexAddress(c.tokenMessenger)).toBe(true);
      expect(c.messageTransmitter).toBeDefined();
      expect(isHexAddress(c.messageTransmitter)).toBe(true);
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

  test('HyperEVM is enabled and has V2 contracts', () => {
    const hyper = CCTP_CHAINS.find((c) => c.name === 'HyperEVM');
    expect(hyper).toBeDefined();
    expect(isChainDisabled(hyper!)).toBe(false);
    expect(hyper!.tokenMessenger).toBeDefined();
    expect(hyper!.messageTransmitter).toBeDefined();
  });

  test('V2 contracts have the same CREATE2 address on all EVM chains', () => {
    const evmChains = CCTP_CHAINS.filter((c) => c.isEvm && c.tokenMessenger);
    const messengerAddrs = new Set(evmChains.map((c) => c.tokenMessenger?.toLowerCase()));
    const transmitterAddrs = new Set(evmChains.map((c) => c.messageTransmitter?.toLowerCase()));
    expect(messengerAddrs.size).toBe(1);
    expect(transmitterAddrs.size).toBe(1);
  });

  test('USDC_DECIMALS is the standard 6', () => {
    expect(USDC_DECIMALS).toBe(6);
  });

  test('CIRCLE_API_V2_BASE points at iris-api', () => {
    expect(CIRCLE_API_V2_BASE.startsWith('https://iris-api.circle.com')).toBe(true);
  });

  test('FINALITY_THRESHOLD has correct fast and standard values', () => {
    expect(FINALITY_THRESHOLD.fast).toBe(1000);
    expect(FINALITY_THRESHOLD.standard).toBe(2000);
  });

  test('ERC20 ABI exports include the functions the app calls', () => {
    const erc20Names = ERC20_ABI.map((e) => e.name);
    expect(erc20Names).toEqual(expect.arrayContaining(['allowance', 'approve', 'balanceOf', 'decimals']));
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
});
