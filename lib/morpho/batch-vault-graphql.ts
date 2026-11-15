import { getAddress } from 'viem';
import { morphoGraphQLClient } from '@/lib/morpho/graphql-client';

type VaultRef = { address: string; chainId: number };

/** `morphoGraphQLClient` prefixes GraphQL-level errors; transport failures do not have it. */
function isGraphQLError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith('GraphQL Error:');
}

function aliasName(prefix: string, index: number): string {
  return `${prefix}${index}`;
}

/**
 * One GraphQL HTTP round-trip: aliased `vaultV2ByAddress` for each vault.
 * Addresses come from config (checksummed), not request input.
 */
export async function batchVaultV2ByAddress<T>(
  vaults: VaultRef[],
  selection: string
): Promise<Map<string, T | null>> {
  const out = new Map<string, T | null>();
  if (vaults.length === 0) return out;

  const fields = vaults.map((v, i) => {
    const addr = getAddress(v.address);
    return `${aliasName('v', i)}: vaultV2ByAddress(address: "${addr}", chainId: ${v.chainId}) { ${selection} }`;
  });
  const query = `query BatchVaultV2ByAddress {\n${fields.join('\n')}\n}`;

  let data: Record<string, T | null>;
  try {
    data = await morphoGraphQLClient.request<Record<string, T | null>>(query);
  } catch (error) {
    // One unindexed or mistyped vault fails the whole aliased query (Morpho returns
    // data: null). Retry each vault alone so the others still load; that vault reads null.
    // A 429, timeout or network failure is not split: N parallel retries would only
    // deepen an upstream outage.
    if (vaults.length === 1 || !isGraphQLError(error)) throw error;
    const single = await Promise.all(
      vaults.map((v) =>
        batchVaultV2ByAddress<T>([v], selection).then(
          (m) => m.get(v.address.toLowerCase()) ?? null,
          // Only a GraphQL error means "this vault reads null". A timeout, 429 or network error
          // fails the whole read, so callers never cache a list with a real vault missing.
          (singleError: unknown) => {
            if (isGraphQLError(singleError)) return null;
            throw singleError;
          }
        )
      )
    );
    vaults.forEach((v, i) => out.set(v.address.toLowerCase(), single[i]));
    return out;
  }
  vaults.forEach((v, i) => {
    out.set(v.address.toLowerCase(), data[aliasName('v', i)] ?? null);
  });
  return out;
}

export async function batchVaultV2AllocationTransactions<T>(
  vaults: VaultRef[],
  first: number,
  senders: string[]
): Promise<Map<string, T | null>> {
  const out = new Map<string, T | null>();
  if (vaults.length === 0) return out;

  const senderList = senders.map((s) => `"${getAddress(s)}"`).join(', ');
  const fields = vaults.map((v, i) => {
    const addr = getAddress(v.address);
    return `${aliasName('r', i)}: vaultV2AllocationTransactions(
      vaultAddress: "${addr}"
      chainId: ${v.chainId}
      first: ${first}
      skip: 0
      orderBy: Timestamp
      orderDirection: Desc
      where: { sender_in: [${senderList}] }
    ) { items { txHash blockNumber timestamp type assets change adapter ids sender } }`;
  });
  const query = `query BatchVaultV2Realloc {\n${fields.join('\n')}\n}`;
  const data = await morphoGraphQLClient.request<Record<string, T | null>>(query);
  vaults.forEach((v, i) => {
    out.set(v.address.toLowerCase(), data[aliasName('r', i)] ?? null);
  });
  return out;
}
