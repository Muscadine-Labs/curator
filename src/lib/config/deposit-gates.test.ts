import { describe, expect, it } from 'vitest';
import { getAddress } from 'viem';
import {
  depositGateGateWhitelisters,
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
    const configured = depositGateGateWhitelisters().map((row) => row.address.toLowerCase());
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
