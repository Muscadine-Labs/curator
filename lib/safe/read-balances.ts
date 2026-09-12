import { erc20Abi, getAddress, type Address } from 'viem';
import { publicClient } from '@/lib/onchain/client';
import {
  getDefaultSafeTokens,
  isNativeToken,
  NATIVE_TOKEN_ADDRESS,
  type SafeTokenMeta,
} from '@/lib/safe/tokens';

export type SafeTokenBalance = SafeTokenMeta & {
  balance: bigint;
};

/**
 * Balances for the curated token set plus any caller-supplied addresses.
 *
 * One multicall covers every ERC-20 read. Unknown tokens also need
 * symbol/name/decimals, so they cost three extra calls each — still batched
 * into the same round trip. Zero balances are returned; the UI decides whether
 * to hide them.
 */
export async function readSafeTokenBalances(
  safeAddress: Address,
  extraTokens: ReadonlyArray<Address> = []
): Promise<SafeTokenBalance[]> {
  const address = getAddress(safeAddress);
  const known = getDefaultSafeTokens();
  const knownAddresses = new Set(
    known.filter((t) => !isNativeToken(t.address)).map((t) => t.address.toLowerCase())
  );
  const unknown = extraTokens
    .map((t) => getAddress(t))
    .filter((t) => !knownAddresses.has(t.toLowerCase()));

  const knownErc20 = known.filter(
    (t): t is SafeTokenMeta & { address: Address } => !isNativeToken(t.address)
  );

  const contracts = [
    ...knownErc20.map((token) => ({
      address: token.address,
      abi: erc20Abi,
      functionName: 'balanceOf' as const,
      args: [address] as const,
    })),
    ...unknown.flatMap((token) => [
      { address: token, abi: erc20Abi, functionName: 'balanceOf' as const, args: [address] as const },
      { address: token, abi: erc20Abi, functionName: 'symbol' as const },
      { address: token, abi: erc20Abi, functionName: 'name' as const },
      { address: token, abi: erc20Abi, functionName: 'decimals' as const },
    ]),
  ];

  const [nativeBalance, results] = await Promise.all([
    publicClient.getBalance({ address }),
    contracts.length > 0
      ? publicClient.multicall({ contracts, allowFailure: true })
      : Promise.resolve([]),
  ]);

  const out: SafeTokenBalance[] = [
    {
      address: NATIVE_TOKEN_ADDRESS,
      symbol: 'ETH',
      name: 'Ether',
      decimals: 18,
      kind: 'native',
      balance: nativeBalance,
    },
  ];

  knownErc20.forEach((token, i) => {
    const result = results[i];
    if (result?.status !== 'success') return;
    out.push({
      ...token,
      balance: result.result as bigint,
    });
  });

  const unknownOffset = knownErc20.length;
  unknown.forEach((token, i) => {
    const base = unknownOffset + i * 4;
    const balance = results[base];
    const symbol = results[base + 1];
    const name = results[base + 2];
    const decimals = results[base + 3];
    // A non-token address fails every read — skip it rather than showing a row
    // of dashes the user cannot act on.
    if (balance?.status !== 'success' || decimals?.status !== 'success') return;
    out.push({
      address: token,
      symbol: symbol?.status === 'success' ? (symbol.result as string) : 'UNKNOWN',
      name: name?.status === 'success' ? (name.result as string) : token,
      decimals: Number(decimals.result),
      kind: 'erc20',
      balance: balance.result as bigint,
    });
  });

  return out;
}
