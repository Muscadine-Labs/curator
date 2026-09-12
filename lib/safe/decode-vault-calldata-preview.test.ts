import { describe, expect, it } from 'vitest';
import { encodeFunctionData, erc20Abi, getAddress, type Hex } from 'viem';
import {
  describeSafeTxSource,
  inferSafeTxSource,
  resolveSafePendingPreview,
  resolveVaultAddressFromPending,
} from '@/lib/safe/decode-vault-calldata-preview';
import { vaultV2Abi } from '@/lib/onchain/abis';
import { DEPOSIT_GATE_CONTRACT_ADDRESS } from '@/lib/config/deposit-gates';
import {
  encodeGateSetIsWhitelisted,
  encodeGateSetIsWhitelister,
} from '@/lib/morpho/vault-v2-gates';
import { sanitizeImportedPending } from '@/lib/safe/pending-store';
import type { SafePendingTransaction } from '@/lib/safe/types';

const RECIPIENT = getAddress('0x000000000000000000000000000000000000dEaD');
const ZERO = getAddress('0x0000000000000000000000000000000000000000');
const USDC = getAddress('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
/** A tracked vault — its shares are an ERC-20 at the same address. */
const VAULT_SHARES = getAddress('0x036A01eFdDC87F6634FFDE0533EE528b90fc7A45');
const ACCOUNT = getAddress('0x628037c2d25f5e5f6f90415cff6d7e8860f41c08');

const transferData = (amount: bigint) =>
  encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [RECIPIENT, amount] });

/** Mirrors what service-sync builds for a transaction imported with no preview. */
function imported(to: string, data: Hex, value = '0'): SafePendingTransaction {
  return {
    id: 'x',
    safeRole: 'treasury',
    safeAddress: getAddress('0x057fd8B961Eb664baA647a5C7A6e9728fabA266A'),
    safeTxHash: '0xabc',
    to: getAddress(to),
    value,
    data,
    operation: 0,
    safeTxGas: '0',
    baseGas: '0',
    gasPrice: '0',
    gasToken: ZERO,
    refundReceiver: ZERO,
    nonce: '23',
    status: 'awaiting_signatures',
    proposer: null,
    description: 'Safe transaction',
    source: inferSafeTxSource(getAddress(to), data, value),
    preview: null,
    signatures: [],
    createdAt: '',
    updatedAt: '',
  } as unknown as SafePendingTransaction;
}

describe('inferSafeTxSource', () => {
  it('classifies a vault-share transfer as a transfer, not a vault write', () => {
    const source = inferSafeTxSource(VAULT_SHARES, transferData(1_500_000_000_000_000_000n));
    expect(source.type).toBe('transfer');
    if (source.type !== 'transfer') return;
    expect(source.recipient).toBe(RECIPIENT);
    expect(source.amount).toBe('1500000000000000000');
  });

  it('classifies a native value transfer', () => {
    const source = inferSafeTxSource(RECIPIENT, '0x', '1000000000000000');
    expect(source).toMatchObject({ type: 'transfer', token: 'native', tokenSymbol: 'ETH' });
  });

  it('still classifies real vault calldata as a vault operation', () => {
    const data = encodeFunctionData({
      abi: vaultV2Abi,
      functionName: 'deallocate',
      args: [RECIPIENT, '0x', 5_000_000n],
    });
    expect(inferSafeTxSource(VAULT_SHARES, data)).toMatchObject({ type: 'allocation' });
  });

  it('falls back to manual for an unrecognised target and calldata', () => {
    expect(inferSafeTxSource(RECIPIENT, '0xdeadbeef')).toEqual({ type: 'manual' });
  });

  it('classifies a configured-gate allowlist write', () => {
    const data = encodeGateSetIsWhitelisted(ACCOUNT, true);
    expect(inferSafeTxSource(DEPOSIT_GATE_CONTRACT_ADDRESS, data)).toMatchObject({
      type: 'gate',
      action: 'set_whitelisted',
      gateAddress: DEPOSIT_GATE_CONTRACT_ADDRESS,
    });
  });

  it('classifies a configured-gate whitelister write', () => {
    const data = encodeGateSetIsWhitelister(ACCOUNT, false);
    expect(inferSafeTxSource(DEPOSIT_GATE_CONTRACT_ADDRESS, data)).toMatchObject({
      type: 'gate',
      action: 'set_whitelister',
      gateAddress: DEPOSIT_GATE_CONTRACT_ADDRESS,
    });
  });
});

describe('describeSafeTxSource', () => {
  it('labels a Curator-origin transfer as a send, not a vault action', () => {
    const source = inferSafeTxSource(USDC, transferData(1_000_000n));
    expect(describeSafeTxSource(source, USDC)).toMatch(/^Send /);
    expect(describeSafeTxSource(source, USDC)).not.toMatch(/Vault/i);
  });

  it('labels native ETH sends', () => {
    const source = inferSafeTxSource(RECIPIENT, '0x', '1');
    expect(describeSafeTxSource(source, RECIPIENT)).toContain('ETH');
  });
});

describe('resolveSafePendingPreview — token movements', () => {
  it('shows amount and recipient for a vault-share transfer', () => {
    // Regression: this previously rendered "Undecoded calldata" with no
    // recipient, so an owner signed without seeing where funds were going.
    const preview = resolveSafePendingPreview(
      imported(VAULT_SHARES, transferData(1_500_000_000_000_000_000n))
    );
    expect(preview.title).toContain('1.500000');
    expect(preview.changes[0].subtitle).toContain(RECIPIENT);
    expect(preview.changes[0].delta).toContain('−1.500000');
  });

  it('uses the token symbol and decimals for a known ERC-20', () => {
    const preview = resolveSafePendingPreview(imported(USDC, transferData(2_500_000n)));
    expect(preview.title).toBe('Send 2.500000 USDC');
  });

  it('shows raw units and warns for an unknown token', () => {
    const unknown = getAddress('0x1111111111111111111111111111111111111111');
    const preview = resolveSafePendingPreview(imported(unknown, transferData(42n)));
    expect(preview.title).toContain('42 raw units');
    expect(preview.footnote).toContain('decimals unknown');
  });

  it('decodes a native ETH transfer that carries no calldata', () => {
    const preview = resolveSafePendingPreview(imported(RECIPIENT, '0x', '1000000000000000'));
    expect(preview.title).toBe('Send 0.001000 ETH');
  });
});

describe('resolveVaultAddressFromPending', () => {
  it('does not link a share transfer to the vault page', () => {
    expect(
      resolveVaultAddressFromPending(imported(VAULT_SHARES, transferData(1n)))
    ).toBeNull();
  });

  it('still links a genuine vault write', () => {
    const data = encodeFunctionData({
      abi: vaultV2Abi,
      functionName: 'deallocate',
      args: [RECIPIENT, '0x', 5_000_000n],
    });
    expect(resolveVaultAddressFromPending(imported(VAULT_SHARES, data))).toBe(VAULT_SHARES);
  });
});

describe('imported gate writes', () => {
  it('shows the account and allow/deny, not a generic Safe transaction', () => {
    const preview = resolveSafePendingPreview(
      imported(DEPOSIT_GATE_CONTRACT_ADDRESS, encodeGateSetIsWhitelisted(ACCOUNT, false))
    );
    expect(preview.title).toMatch(/deny/i);
    expect(preview.changes[0]?.subtitle).toContain(ACCOUNT);
    expect(preview.changes[0]?.delta).toBe('deny');
  });

  it('labels imported gate txs as Gate …, not a vault action', () => {
    const source = inferSafeTxSource(
      DEPOSIT_GATE_CONTRACT_ADDRESS,
      encodeGateSetIsWhitelisted(ACCOUNT, true)
    );
    expect(describeSafeTxSource(source, DEPOSIT_GATE_CONTRACT_ADDRESS)).toMatch(/^Gate /);
  });

  it('drops a stored preview and re-classifies from calldata on import', () => {
    const tx = imported(
      DEPOSIT_GATE_CONTRACT_ADDRESS,
      encodeGateSetIsWhitelisted(ACCOUNT, true)
    ) as SafePendingTransaction;
    tx.source = { type: 'manual' };
    tx.preview = {
      title: 'Send 1.000000 USDC',
      changes: [{ action: 'withdraw', label: 'USDC' }],
    };
    const cleaned = sanitizeImportedPending(tx);
    expect(cleaned.preview).toBeNull();
    expect(cleaned.source).toMatchObject({ type: 'gate', action: 'set_whitelisted' });
  });
});
