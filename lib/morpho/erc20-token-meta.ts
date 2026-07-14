import { isAddress, getAddress, type Address, type PublicClient } from 'viem';
import { parseAbi } from 'viem';

const erc20MetaAbi = parseAbi([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
]);

/** Some legacy tokens return bytes32 for symbol/name. */
const erc20Bytes32MetaAbi = parseAbi([
  'function name() view returns (bytes32)',
  'function symbol() view returns (bytes32)',
]);

export type Erc20TokenMeta = {
  address: Address;
  name: string;
  symbol: string;
  decimals: number;
};

export type Erc20TokenLookup =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; token: Erc20TokenMeta }
  | { status: 'invalid'; address?: Address; error: string };

function decodeBytes32String(raw: `0x${string}`): string {
  const hex = raw.slice(2);
  let out = '';
  for (let i = 0; i < hex.length; i += 2) {
    const code = Number.parseInt(hex.slice(i, i + 2), 16);
    if (code === 0) break;
    out += String.fromCharCode(code);
  }
  return out.trim();
}

async function readStringOrBytes32(
  client: PublicClient,
  address: Address,
  fn: 'name' | 'symbol'
): Promise<string> {
  try {
    const value = await client.readContract({
      address,
      abi: erc20MetaAbi,
      functionName: fn,
    });
    if (typeof value === 'string' && value.trim()) return value.trim();
  } catch {
    /* try bytes32 */
  }
  const raw = await client.readContract({
    address,
    abi: erc20Bytes32MetaAbi,
    functionName: fn,
  });
  return decodeBytes32String(raw as `0x${string}`);
}

/**
 * Resolve ERC-20 name/symbol/decimals on-chain. Returns null for empty input.
 * Throws (via result) when address is malformed or not a readable ERC-20.
 */
export async function lookupErc20TokenMeta(
  client: PublicClient,
  rawAddress: string
): Promise<Erc20TokenLookup> {
  const trimmed = rawAddress.trim();
  if (!trimmed) return { status: 'idle' };
  if (!isAddress(trimmed)) {
    return { status: 'invalid', error: 'Not a valid address.' };
  }

  const address = getAddress(trimmed) as Address;
  try {
    const code = await client.getBytecode({ address });
    if (!code || code === '0x') {
      return {
        status: 'invalid',
        address,
        error: 'No contract at this address.',
      };
    }

    const [name, symbol, decimals] = await Promise.all([
      readStringOrBytes32(client, address, 'name'),
      readStringOrBytes32(client, address, 'symbol'),
      client.readContract({
        address,
        abi: erc20MetaAbi,
        functionName: 'decimals',
      }),
    ]);

    if (!symbol) {
      return {
        status: 'invalid',
        address,
        error: 'Contract did not return an ERC-20 symbol.',
      };
    }

    return {
      status: 'ok',
      token: {
        address,
        name: name || symbol,
        symbol,
        decimals: Number(decimals),
      },
    };
  } catch (err) {
    return {
      status: 'invalid',
      address,
      error:
        err instanceof Error
          ? err.message
          : 'Could not read ERC-20 metadata (name/symbol/decimals).',
    };
  }
}
