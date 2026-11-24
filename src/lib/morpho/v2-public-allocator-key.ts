/** Adapter + market — two adapters can share a Morpho market id. */
export function publicAllocatorMarketLookupKey(
  adapterAddress: string,
  marketKey: string
): string {
  return `${adapterAddress.toLowerCase()}:${marketKey.toLowerCase()}`;
}
