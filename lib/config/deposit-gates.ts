/**
 * Morpho Vault V2 send-assets gate rollout (WhitelistSendAssetsGate).
 *
 * **Underlying-only:** gate the four production strategy vaults. Whitelist adapters
 * (wrapper allocate path), Treasury, and partner depositor wallets. Fee-wrapper vaults
 * stay open (`sendAssetsGate = 0x0`).
 *
 * Gate contract address is set after deployment via `SEND_ASSETS_GATE_ADDRESS` (or env).
 * See `docs/brain/deposit-gates.md`. Writes: muscadine-onchain `gate` commands.
 */
import type { Address } from 'viem';
import { getAddress } from 'viem';
import {
  getConfiguredVaultDisplayName,
  getVaultAddressesForBusinessViews,
  getVaultByAddress,
  type VaultAddressConfig,
} from '@/lib/config/vaults';
import { TREASURY_ADDRESS } from '@/lib/morpho/treasury-statement';
import { getSafeByAddress, getSafeByRole } from '@/lib/safe/config';

export type AllowlistedAddress = {
  address: Address;
  label: string;
};

/** Production fee-wrapper → MorphoVaultV2Adapter → underlying (no test vaults). */
export type DepositGateWrapperAdapterPair = {
  wrapperAddress: Address;
  wrapperLabel: string;
  adapterAddress: Address;
  underlyingAddress: Address;
  underlyingLabel: string;
};

/** Set after Morpho WhitelistSendAssetsGate is deployed — not used until then. */
export const SEND_ASSETS_GATE_ADDRESS: Address | null = process.env.SEND_ASSETS_GATE_ADDRESS
  ? getAddress(process.env.SEND_ASSETS_GATE_ADDRESS)
  : process.env.GATE_ADDRESS
    ? getAddress(process.env.GATE_ADDRESS)
    : null;

const DEFAULT_GATE_ADDRESS = '0xb7f2598ac79a3c6406dddb81edcc60ea72a134b9';
const DEFAULT_GATE_DEPLOY_BLOCK = 50_928_622n;

/** Default production gate (Base, 2026-09-05 deploy). Override via env when redeploying. */
export const DEPOSIT_GATE_CONTRACT_ADDRESS: Address = getAddress(
  process.env.SEND_ASSETS_GATE_ADDRESS ??
    process.env.GATE_ADDRESS ??
    DEFAULT_GATE_ADDRESS
);

/**
 * First block of the default gate (`0xb7f2…34b9`), where the roster event scan
 * starts. A redeployed gate sets `SEND_ASSETS_GATE_DEPLOY_BLOCK`; without it the
 * server finds the block by bisecting `eth_getCode`.
 */
export function depositGateDeployBlock(gate: Address): bigint | null {
  const fromEnv = process.env.SEND_ASSETS_GATE_DEPLOY_BLOCK?.trim();
  if (fromEnv && /^\d+$/.test(fromEnv)) return BigInt(fromEnv);
  return gate.toLowerCase() === DEFAULT_GATE_ADDRESS ? DEFAULT_GATE_DEPLOY_BLOCK : null;
}

/**
 * Safes that may call `setIsWhitelisted` on the gate (`roleSetter` appoints via
 * `setIsWhitelister`). Allocator can manage the deposit allowlist without Curator Safe.
 */
export function depositGateGateWhitelisters(): AllowlistedAddress[] {
  const allocatorEnv = process.env.ALLOCATOR_SAFE_8453?.trim();
  const allocator = allocatorEnv ? getAddress(allocatorEnv) : getSafeByRole('allocator').address;
  return [
    { address: getAddress(getSafeByRole('curator').address), label: 'Curator Safe' },
    { address: getAddress(allocator), label: 'Allocator Safe' },
  ];
}

/**
 * Partner / rebate depositor wallets — also whitelisted on the underlying gate
 * (can deposit underlying directly as `msg.sender`, in addition to wrapper path).
 */
export const DEPOSIT_GATE_DEPOSITOR_ALLOWLIST: readonly AllowlistedAddress[] = [
  {
    address: getAddress('0x628037c2d25f5e5f6f90415cff6d7e8860f41c08'),
    label: 'Rebate allowlist',
  },
  {
    address: getAddress(TREASURY_ADDRESS),
    label: 'Treasury',
  },
  {
    address: getAddress('0xf35b121ba32cbeaa27716abeffb6b65a55f9b333'),
    label: 'Allowlisted depositor',
  },
  {
    address: getAddress('0x31E70f063cA802DedCd76e74C8F6D730eC43D9f0'),
    label: 'Rebate allowlist',
  },
  {
    address: getAddress('0x0d5a708b651fee1daa0470431c4262ab3e1d0261'),
    label: 'Rebate allowlist',
  },
];

function labelForAddress(address: string): string {
  const safe = getSafeByAddress(address);
  if (safe) return safe.label === 'Treasury' ? 'Treasury' : `${safe.label} Safe`;
  const vault = getVaultByAddress(address);
  if (vault) return getConfiguredVaultDisplayName(vault);
  const depositor = DEPOSIT_GATE_DEPOSITOR_ALLOWLIST.find(
    (row) => row.address.toLowerCase() === address.toLowerCase()
  );
  if (depositor) return depositor.label;
  return 'MorphoVaultV2Adapter';
}

/** Production strategy vaults that receive `setSendAssetsGate` (excludes test vaults). */
export function getUnderlyingVaultsForDepositGate(): VaultAddressConfig[] {
  return getVaultAddressesForBusinessViews().filter((v) => v.kind !== 'feeWrapper');
}

/** Four production wrapper ↔ adapter ↔ underlying rows (excludes test vaults). */
export function depositGateWrapperAdapterPairs(): DepositGateWrapperAdapterPair[] {
  return getVaultAddressesForBusinessViews()
    .filter((v) => v.kind === 'feeWrapper' && v.adapterAddress && v.underlyingAddress)
    .map((wrapper) => {
      const underlying = getVaultByAddress(wrapper.underlyingAddress!)!;
      return {
        wrapperAddress: getAddress(wrapper.address),
        wrapperLabel: getConfiguredVaultDisplayName(wrapper),
        adapterAddress: getAddress(wrapper.adapterAddress!),
        underlyingAddress: getAddress(underlying.address),
        underlyingLabel: getConfiguredVaultDisplayName(underlying),
      };
    });
}

/** MorphoVaultV2Adapter contracts — `msg.sender` when supplying the underlying vault. */
export function depositGateAdapterAllowlist(): AllowlistedAddress[] {
  return depositGateWrapperAdapterPairs().map((pair) => ({
    address: pair.adapterAddress,
    label: `${pair.wrapperLabel} adapter → ${pair.underlyingLabel}`,
  }));
}

/** Adapters + partner depositors (+ Treasury) on the shared gate. */
export function depositGateWhitelistForUnderlying(): AllowlistedAddress[] {
  return dedupeAllowlist([
    ...depositGateAdapterAllowlist(),
    ...DEPOSIT_GATE_DEPOSITOR_ALLOWLIST,
  ]);
}

/** Full gate whitelist (underlying-only rollout). */
export function depositGateFullWhitelist(): AllowlistedAddress[] {
  return depositGateWhitelistForUnderlying();
}

export type ConfiguredSendAssetsGate = {
  address: Address;
  label: string;
};

/** Gates the curator UI can interact with. One shared gate today. */
export function configuredSendAssetsGates(): ConfiguredSendAssetsGate[] {
  return [
    {
      address: DEPOSIT_GATE_CONTRACT_ADDRESS,
      label: 'Shared send-assets gate (all underlying vaults)',
    },
  ];
}

export function resolveAllowlistLabel(address: string): string {
  const normalized = address.toLowerCase();
  for (const row of depositGateFullWhitelist()) {
    if (row.address.toLowerCase() === normalized) return row.label;
  }
  return labelForAddress(address);
}

function dedupeAllowlist(rows: AllowlistedAddress[]): AllowlistedAddress[] {
  const out: AllowlistedAddress[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const key = row.address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}
