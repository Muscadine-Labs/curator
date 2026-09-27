/**
 * Morpho Vault V2 send-assets gate rollout (WhitelistSendAssetsGate).
 *
 * **Underlying-only:** the four production strategy vaults point at one shared gate.
 * Who may deposit is whatever that gate returns (`isWhitelisted`), not a list in this
 * file. Fee-wrapper vaults stay open (`sendAssetsGate = 0x0`).
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

/** Default production gate (Base, 2026-09-05 deploy). Override via env when redeploying. */
export const DEPOSIT_GATE_CONTRACT_ADDRESS: Address = getAddress(
  process.env.SEND_ASSETS_GATE_ADDRESS ??
    process.env.GATE_ADDRESS ??
    DEFAULT_GATE_ADDRESS
);

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
 * Display names for addresses the gate may return. This is not the allowlist.
 * Membership comes from the gate contract.
 */
const GATE_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  [getAddress('0x628037c2d25f5e5f6f90415cff6d7e8860f41c08').toLowerCase()]:
    'nwlutkoski.base.eth',
  [getAddress('0xf35b121ba32cbeaa27716abeffb6b65a55f9b333').toLowerCase()]:
    'muscadine.base.eth',
  [getAddress('0x31E70f063cA802DedCd76e74C8F6D730eC43D9f0').toLowerCase()]:
    'nickwc.base.eth',
  [getAddress('0x0d5a708b651fee1daa0470431c4262ab3e1d0261').toLowerCase()]:
    'ignitis.base.eth',
};

function labelForAddress(address: string): string {
  const named = GATE_DISPLAY_NAMES[address.toLowerCase()];
  if (named) return named;
  const safe = getSafeByAddress(address);
  if (safe) return safe.role === 'treasury' ? 'Muscadine Treasury' : `${safe.label} Safe`;
  const vault = getVaultByAddress(address);
  if (vault) return getConfiguredVaultDisplayName(vault);
  const adapter = depositGateAdapterAllowlist().find(
    (row) => row.address.toLowerCase() === address.toLowerCase()
  );
  if (adapter) return adapter.label;
  return 'Whitelisted address';
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

/**
 * Adapter contracts the wrappers use to deposit. Labels only — whether each
 * adapter is whitelisted is read from the gate.
 */
export function depositGateWhitelistForUnderlying(): AllowlistedAddress[] {
  return dedupeAllowlist(depositGateAdapterAllowlist());
}

/** @deprecated Use the gate's `isWhitelisted` roster. Adapters only, for labels. */
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
