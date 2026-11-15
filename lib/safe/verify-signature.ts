import { hashMessage, hexToNumber, recoverAddress, type Address, type Hex } from 'viem';

/**
 * Whether a stored Safe owner signature really signs `safeTxHash` for `signer`.
 * Imported bundles and Transaction Service rows are only format-checked when merged, and
 * a signature for another hash would make `execTransaction` revert (GS026) after the
 * executor pays gas.
 *
 * Returns `null` when the signature cannot be checked offline: contract signatures
 * (v = 0, EIP-1271) and pre-approved hashes (v = 1) are verified by the Safe on chain.
 */
export async function signatureMatchesSigner(
  safeTxHash: Hex,
  signer: Address,
  signature: Hex
): Promise<boolean | null> {
  // Every Safe signature starts with r (32) + s (32) + v (1) bytes.
  if (signature.length < 132) return false;
  const v = hexToNumber(`0x${signature.slice(130, 132)}`);
  // Contract signatures (v = 0) carry dynamic data after the 65 bytes; the Safe checks them.
  if (v === 0 || v === 1) return null;
  // An ECDSA signature is exactly 65 bytes; anything else would fail GS026 on chain.
  if (signature.length !== 132) return false;
  try {
    let recovered: Address;
    if (v === 27 || v === 28) {
      recovered = await recoverAddress({ hash: safeTxHash, signature });
    } else if (v === 31 || v === 32) {
      // eth_sign: the Safe adds 4 to v and checks the personal-message hash of safeTxHash.
      const adjusted = `${signature.slice(0, 130)}${(v - 4).toString(16)}` as Hex;
      recovered = await recoverAddress({ hash: hashMessage({ raw: safeTxHash }), signature: adjusted });
    } else {
      return false;
    }
    return recovered.toLowerCase() === signer.toLowerCase();
  } catch {
    return false;
  }
}
