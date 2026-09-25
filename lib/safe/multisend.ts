import {
  decodeFunctionData,
  getAddress,
  hexToBigInt,
  hexToNumber,
  parseAbi,
  sliceHex,
  size,
  type Address,
  type Hex,
} from 'viem';

/**
 * Canonical Safe MultiSend / MultiSendCallOnly deployments on Base
 * (safe-deployments v1.3.0 canonical + eip155, v1.4.1, v1.5.0). These are the
 * only DelegateCall targets a Curator-built proposal ever uses: protocol-kit
 * wraps batches in MultiSendCallOnly.
 */
const MULTI_SEND_CALL_ONLY = new Set(
  [
    '0x40A2aCCbd92BCA938b02010E17A5b8929b49130D',
    '0xA1dabEF33b3B82c7814B6D82A79e50F4AC44102B',
    '0x9641d764fc13c8B624c04430C7356C1C7C8102e2',
    '0xA83c336B20401Af773B6219BA5027174338D1836',
  ].map((a) => a.toLowerCase())
);

/** Full MultiSend also allows nested DelegateCalls, so its inner ops are checked. */
const MULTI_SEND = new Set(
  [
    '0xA238CBeb142c10Ef7Ad8442C6D1f9E89e07e7761',
    '0x998739BFdAAdde7C933B942a68053933098f9EDa',
    '0x38869bf66a61cF6bDB996A6aE40D5853Fd43B526',
    '0x218543288004CD07832472D464648173c77D7eB7',
  ].map((a) => a.toLowerCase())
);

const multiSendAbi = parseAbi(['function multiSend(bytes transactions)']);

export function isKnownMultiSend(address: string): boolean {
  const lower = address.toLowerCase();
  return MULTI_SEND_CALL_ONLY.has(lower) || MULTI_SEND.has(lower);
}

export type MultiSendInnerTx = {
  operation: 0 | 1;
  to: Address;
  value: bigint;
  data: Hex;
};

/**
 * Decode `multiSend(bytes)` into its packed inner transactions
 * (`uint8 operation | address to | uint256 value | uint256 len | bytes data`).
 * Returns null when the calldata is not a well-formed multiSend.
 */
export function decodeMultiSend(data: Hex): MultiSendInnerTx[] | null {
  let packed: Hex;
  try {
    const decoded = decodeFunctionData({ abi: multiSendAbi, data });
    packed = decoded.args[0];
  } catch {
    return null;
  }

  const txs: MultiSendInnerTx[] = [];
  const total = size(packed);
  let offset = 0;
  try {
    while (offset < total) {
      const operation = hexToNumber(sliceHex(packed, offset, offset + 1));
      if (operation !== 0 && operation !== 1) return null;
      const to = getAddress(sliceHex(packed, offset + 1, offset + 21));
      const value = hexToBigInt(sliceHex(packed, offset + 21, offset + 53));
      const length = Number(hexToBigInt(sliceHex(packed, offset + 53, offset + 85)));
      const start = offset + 85;
      if (start + length > total) return null;
      const innerData = length === 0 ? '0x' : sliceHex(packed, start, start + length);
      txs.push({ operation, to, value, data: innerData });
      offset = start + length;
    }
  } catch {
    return null;
  }
  return txs;
}

/**
 * Plain-language hazards for a Safe transaction, computed from its calldata so
 * they hold even when a stored (or imported) preview says otherwise.
 * `blocking` marks proposals the queue refuses to sign or execute.
 */
export function safeTransactionHazards(tx: {
  to: string;
  operation: number;
  data: Hex;
}): { messages: string[]; blocking: boolean } {
  if (tx.operation !== 1) return { messages: [], blocking: false };

  const target = getAddress(tx.to);
  if (!isKnownMultiSend(target)) {
    return {
      messages: [
        `DelegateCall to ${target}, which is not a Safe MultiSend contract. It would run that contract's code with the Safe's own storage and permissions — it can change owners or the threshold. Curator never builds this; do not sign it here.`,
      ],
      blocking: true,
    };
  }

  const inner = decodeMultiSend(tx.data);
  if (!inner) {
    return {
      messages: ['MultiSend calldata could not be decoded — review the raw transaction before signing.'],
      blocking: true,
    };
  }
  const nested = inner.filter((call) => call.operation === 1);
  if (nested.length > 0) {
    return {
      messages: nested.map(
        (call) =>
          `Nested DelegateCall to ${call.to} inside the MultiSend. It would run with the Safe's own permissions.`
      ),
      blocking: true,
    };
  }
  return { messages: [], blocking: false };
}
