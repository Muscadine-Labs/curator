import { describe, expect, it } from 'vitest';
import { getAddress } from 'viem';
import {
  depositGateAdapterAllowlist,
  depositGateGateWhitelisters,
  depositGateWrapperAdapterPairs,
  resolveAllowlistLabel,
} from '@/lib/config/deposit-gates';
import { TREASURY_ADDRESS } from '@/lib/morpho/treasury-statement';
import {
  buildVaultSetSendAssetsGateCalldata,
  encodeGateSetIsWhitelisted,
  encodeGateWhitelistMulticall,
  encodeSetSendAssetsGateCalldata,
} from '@/lib/morpho/vault-v2-gates';

const GATE = '0x1111111111111111111111111111111111111111';
const VAULT = '0x89712980Cb434eF5aE4AB29349419eb976B0b496';

describe('deposit-gates config', () => {
  it('does not treat depositor wallets as a configured allowlist', () => {
    const configured = depositGateAdapterAllowlist().map((row) => row.address.toLowerCase());
    expect(configured).not.toContain('0x628037c2d25f5e5f6f90415cff6d7e8860f41c08');
    expect(configured).not.toContain(TREASURY_ADDRESS.toLowerCase());
  });

  it('labels gate accounts from Basenames, the treasury Safe, or a plain fallback', () => {
    expect(resolveAllowlistLabel('0x628037c2d25f5e5f6f90415cff6d7e8860f41c08')).toBe(
      'nwlutkoski.base.eth'
    );
    expect(resolveAllowlistLabel(TREASURY_ADDRESS)).toBe('Muscadine Treasury');
    expect(resolveAllowlistLabel('0x1111111111111111111111111111111111111111')).toBe(
      'Whitelisted address'
    );
  });

  it('lists four production wrapper ↔ adapter pairs (no test vaults)', () => {
    const pairs = depositGateWrapperAdapterPairs();
    expect(pairs).toHaveLength(4);
    expect(pairs.map((p) => p.wrapperAddress.toLowerCase())).toEqual([
      '0x036a01efddc87f6634ffde0533ee528b90fc7a45',
      '0x54d8417bd21c86a7806b58f5aa2e2e0bb88b856a',
      '0x548653b09b03a69f93b3890c382fe9dcd245cbc4',
      '0x0e0a857d2af1a2d43c82d1fa54766239cab70147',
    ]);
    expect(pairs.map((p) => p.adapterAddress.toLowerCase())).toEqual([
      '0x8b6e43cce1961d3671a39fe8d9e711e69ddd74ce',
      '0x5b211da4cd92cfb9cccfbd1de78289955eb236cd',
      '0xf691616dd2cf85c9ca9fa32bdff00f5cd92bad81',
      '0xa3b90423fd6f70b9f4a424debfb27ac502ac1464',
    ]);
  });

  it('uses wrapper adapters only as labels, not a depositor roster', () => {
    const adapters = depositGateAdapterAllowlist();
    expect(adapters).toHaveLength(4);
    const addresses = adapters.map((adapter) => adapter.address.toLowerCase());
    expect(addresses).not.toContain('0x628037c2d25f5e5f6f90415cff6d7e8860f41c08');
    expect(addresses).not.toContain(TREASURY_ADDRESS.toLowerCase());
  });

  it('lists curator and allocator as gate whitelisters', () => {
    const whitelisters = depositGateGateWhitelisters().map((r) => r.address.toLowerCase());
    expect(whitelisters).toEqual([
      '0xb6d1d784e9bc3570546e231cacb52b4e0f1ed8b1',
      '0x2ed45bb3542d06d81d117acd8a561e910a17a618',
    ]);
  });

});

describe('vault-v2-gates encoding', () => {
  it('encodes setSendAssetsGate submit/accept calldata', () => {
    const gate = getAddress(GATE);
    const accept = encodeSetSendAssetsGateCalldata(gate);
    const row = buildVaultSetSendAssetsGateCalldata(getAddress(VAULT), 'USDC Prime', gate);
    expect(row.submitData).toBe(accept);
    expect(row.acceptData).toBe(accept);
    expect(accept.startsWith('0x871c979c')).toBe(true);
  });

  it('encodes gate whitelist multicall', () => {
    const data = encodeGateWhitelistMulticall([
      { address: getAddress(TREASURY_ADDRESS), label: 'Treasury' },
    ]);
    expect(data.startsWith('0x')).toBe(true);
    const single = encodeGateSetIsWhitelisted(getAddress(TREASURY_ADDRESS), true);
    expect(single.startsWith('0x09ec923a')).toBe(true);
  });
});
