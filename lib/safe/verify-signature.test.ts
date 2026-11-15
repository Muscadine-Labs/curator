import { describe, expect, it } from 'vitest';
import { hexToNumber, keccak256, toHex, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { signatureMatchesSigner } from '@/lib/safe/verify-signature';

const account = privateKeyToAccount(`0x${'11'.repeat(32)}`);
const other = privateKeyToAccount(`0x${'22'.repeat(32)}`);
const HASH = keccak256(toHex('safe tx'));
const OTHER_HASH = keccak256(toHex('another safe tx'));

describe('signatureMatchesSigner', () => {
  it('accepts an EIP-712 style signature over the safeTxHash', async () => {
    const sig = await account.sign({ hash: HASH });
    expect(await signatureMatchesSigner(HASH, account.address, sig)).toBe(true);
  });

  it('rejects a signature for another hash or another signer', async () => {
    const sig = await account.sign({ hash: OTHER_HASH });
    expect(await signatureMatchesSigner(HASH, account.address, sig)).toBe(false);
    const own = await account.sign({ hash: HASH });
    expect(await signatureMatchesSigner(HASH, other.address, own)).toBe(false);
  });

  it('accepts an eth_sign signature (v + 4)', async () => {
    const sig = await account.signMessage({ message: { raw: HASH } });
    const v = hexToNumber(`0x${sig.slice(130)}`);
    const safeSig = `${sig.slice(0, 130)}${(v + 4).toString(16)}` as Hex;
    expect(await signatureMatchesSigner(HASH, account.address, safeSig)).toBe(true);
  });

  it('leaves contract and approved-hash signatures to the chain', async () => {
    const approved = `0x${'00'.repeat(12)}${account.address.slice(2)}${'00'.repeat(32)}01` as Hex;
    expect(await signatureMatchesSigner(HASH, account.address, approved)).toBeNull();
  });
});
