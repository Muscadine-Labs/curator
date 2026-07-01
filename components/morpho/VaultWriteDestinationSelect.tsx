'use client';

import {
  queueSafeOptions,
  type VaultWriteDestination,
} from '@/lib/safe/vault-write-destination';
import { ALLOCATION_SAFE_ROLE, type SafeRole } from '@/lib/safe/config';

interface VaultWriteDestinationSelectProps {
  destination: VaultWriteDestination;
  onChange: (destination: VaultWriteDestination) => void;
  /** Wallet path can be confirmed (connected + role when required). */
  walletReady: boolean;
  /** Shown when wallet is selected but not ready to confirm. */
  walletHint?: string;
  safeRoles?: ReadonlyArray<SafeRole>;
}

export function VaultWriteDestinationSelect({
  destination,
  onChange,
  walletReady,
  walletHint,
  safeRoles,
}: VaultWriteDestinationSelectProps) {
  const safeOptions = queueSafeOptions(safeRoles);
  const selectedKind = destination.kind;
  const selectedSafeRole =
    destination.kind === 'safe'
      ? destination.role
      : safeOptions[0]?.role ?? ALLOCATION_SAFE_ROLE;

  return (
    <div className="space-y-2 border-t border-slate-200 px-4 py-3 dark:border-slate-800">
      <p className="text-xs font-medium text-slate-700 dark:text-slate-300">Submit via</p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="radio"
            name="vault-write-destination"
            checked={selectedKind === 'wallet'}
            onChange={() => onChange({ kind: 'wallet' })}
            className="h-3.5 w-3.5"
          />
          <span>Current wallet</span>
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="radio"
            name="vault-write-destination"
            checked={selectedKind === 'safe'}
            onChange={() => onChange({ kind: 'safe', role: selectedSafeRole })}
            className="h-3.5 w-3.5"
          />
          <span>Multisig Safe</span>
        </label>
        {selectedKind === 'safe' && safeOptions.length > 0 && (
          <select
            value={selectedSafeRole}
            onChange={(e) => onChange({ kind: 'safe', role: e.target.value as SafeRole })}
            className="h-8 min-w-[10rem] max-w-full rounded-md border border-input bg-background px-2 text-xs"
          >
            {safeOptions.map((opt) => (
              <option key={opt.role} value={opt.role}>
                {opt.label} Safe
              </option>
            ))}
          </select>
        )}
      </div>
      {selectedKind === 'wallet' && !walletReady && walletHint && (
        <p className="text-xs text-amber-700 dark:text-amber-400">{walletHint}</p>
      )}
      {selectedKind === 'safe' && safeOptions.length === 0 && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          No configured multisig holds the required on-chain role for this vault action.
          Use your connected wallet instead.
        </p>
      )}
      {selectedKind === 'safe' && safeOptions.length > 0 && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Queues locally — sign and execute on the Multisig Safe page with an owner hot wallet.
        </p>
      )}
    </div>
  );
}
