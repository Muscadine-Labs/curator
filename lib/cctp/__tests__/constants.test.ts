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
  ERC20_ABI,
  TOKEN_MESSENGER_ABI,
  MESSAGE_TRANSMITTER_ABI,
  getCctpChainById,
  getCctpChainByDomain,
  isChainDisabled,
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

  test('every enabled EVM chain has USDC + TokenMessenger + MessageTransmitter addresses', () => {
    const enabledEvm = CCTP_CHAINS.filter((c) => c.isEvm && !isChainDisabled(c));
    expect(enabledEvm.length).toBeGreaterThan(0);
    for (const c of enabledEvm) {
      expect(c.usdc).toBeDefined();
      expect(c.tokenMessenger).toBeDefined();
      expect(c.messageTransmitter).toBeDefined();
      expect(isHexAddress(c.usdc)).toBe(true);
      expect(isHexAddress(c.tokenMessenger)).toBe(true);
      expect(isHexAddress(c.messageTransmitter)).toBe(true);
    }
  });

  test('every disabled chain has a non-empty disabledReason', () => {
    const disabled = CCTP_CHAINS.filter((c) => isChainDisabled(c));
    expect(disabled.length).toBeGreaterThan(0);
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

  test('HyperEVM is V2-only and disabled', () => {
    const hyper = CCTP_CHAINS.find((c) => c.name === 'HyperEVM');
    expect(hyper?.cctpVersion).toBe('v2');
    expect(isChainDisabled(hyper!)).toBe(true);
  });

  test('USDC_DECIMALS is the standard 6', () => {
    expect(USDC_DECIMALS).toBe(6);
  });

  test('CIRCLE_ATTESTATION_API points at iris-api', () => {
    expect(CIRCLE_ATTESTATION_API.startsWith('https://iris-api.circle.com')).toBe(true);
  });

  test('ABI exports include the functions/events the app calls', () => {
    const erc20Names = ERC20_ABI.map((e) => e.name);
    expect(erc20Names).toEqual(expect.arrayContaining(['allowance', 'approve', 'balanceOf', 'decimals']));

    const messengerNames = TOKEN_MESSENGER_ABI.map((e) => e.name);
    expect(messengerNames).toContain('depositForBurn');

    const mtNames = MESSAGE_TRANSMITTER_ABI.map((e) => e.name);
    expect(mtNames).toContain('receiveMessage');
    expect(mtNames).toContain('MessageSent');
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
    const disabled = getCctpChainById(999)!; // HyperEVM
    expect(isChainDisabled(enabled)).toBe(false);
    expect(isChainDisabled(disabled)).toBe(true);
  });
});
