/**
 * Server-side Base RPC URL. Never uses Alchemy `/demo`.
 * Client wallet RPCs stay in `lib/wallet/config.ts` (Reown AppKit).
 */

export const BASE_PUBLIC_RPC = 'https://mainnet.base.org';

export function getAlchemyBaseRpcUrl(): string | null {
  const key = process.env.ALCHEMY_API_KEY?.trim();
  if (!key) return null;
  return `https://base-mainnet.g.alchemy.com/v2/${key}`;
}

export function getBaseRpcUrl(): string {
  return getAlchemyBaseRpcUrl() ?? BASE_PUBLIC_RPC;
}
