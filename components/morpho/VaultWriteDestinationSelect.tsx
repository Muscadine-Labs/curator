'use client';

import {
  queueSafeOptions,
  type VaultWriteDestination,
} from '@/lib/safe/vault-write-destination';
import type { SafeRole } from '@/lib/safe/config';

interface VaultWriteDestinationSelectProps {
  destination: VaultWriteDestination;
  onChange: (destination: VaultWriteDestination) => void;
  walletEnabled: boolean;
  walletDisabledHint?: string;
  safeRoles?: ReadonlyArray<SafeRole>;
}

export function VaultWriteDestinationSelect({
  destination,
  onChange,
  walletEnabled,
  walletDisabledHint,
  safeRoles,
}: VaultWriteDestinationSelectProps) {
  const safeOptions = queueSafeOptions(safeRoles);
  const selectedKind = destination.kind;
  const selectedSafeRole =
    destination.kind === 'safe' ? destination.role : safeOptions[0]?.role;

  if (safeOptions.length === 0 && selectedKind === 'safe') {
    return (
      <div className="space-y-2 border-t border-slate-200 px-4 py-3 dark:border-slate-800">
        <p className="text-xs text-amber-700 dark:text-amber-400">
          No configured multisig holds the required on-chain role for this vault action.
          Connect a role wallet instead.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2 border-t border-slate-200 px-4 py-3 dark:border-slate-800">
      <p className="text-xs font-medium text-slate-700 dark:text-slate-300">Submit via</p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="radio"
            name="vault-write-destination"
            checked={selectedKind === 'wallet'}
            disabled={!walletEnabled}
            onChange={() => onChange({ kind: 'wallet' })}
            className="h-3.5 w-3.5"
          />
          <span className={walletEnabled ? '' : 'text-slate-400 dark:text-slate-500'}>
            Current wallet
          </span>
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="radio"
            name="vault-write-destination"
            checked={selectedKind === 'safe'}
            onChange={() => {
              if (selectedSafeRole) {
                onChange({ kind: 'safe', role: selectedSafeRole });
              }
            }}
            className="h-3.5 w-3.5"
          />
          <span>Multisig Safe</span>
        </label>
        {selectedKind === 'safe' && selectedSafeRole && (
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
      {!walletEnabled && walletDisabledHint && (
        <p className="text-xs text-slate-500 dark:text-slate-400">{walletDisabledHint}</p>
      )}
      {selectedKind === 'safe' && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Queues locally — sign and execute on the Multisig Safe page with an owner hot wallet.
        </p>
      )}
    </div>
  );
}
