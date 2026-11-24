import { getAddress, type Address } from 'viem';
import { BASE_CHAIN_ID } from '@/lib/constants';
export { MUSCADINE_SAFE_SPACE_URL, SAFE_DEVELOPER_DASHBOARD_URL } from '@/lib/constants/links';

const SAFE_APP_CHAIN_SLUG = 'base';

export function safeAppHomeHref(safeAddress: Address | string): string {
  const address = getAddress(safeAddress);
  return `https://app.safe.global/home?safe=${SAFE_APP_CHAIN_SLUG}:${address}`;
}

export function safeAppChainId(): number {
  return BASE_CHAIN_ID;
}
