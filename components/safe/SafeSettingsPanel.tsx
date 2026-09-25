'use client';

import { useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AddressBadge } from '@/components/AddressBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  CuratorEmptyText,
  CuratorErrorText,
  CuratorKvList,
  CuratorKvRow,
  CuratorPanel,
} from '@/components/morpho/CuratorChrome';
import { apiFetch } from '@/lib/data/api-fetch';
import type { SafeAccountConfig } from '@/lib/safe/config';
import type { SafeOnChainSettings } from '@/lib/safe/onchain-reads';
import {
  EMPTY_ADDRESS_BOOK,
  listAddressBook,
  removeAddressBookEntry,
  subscribeAddressBook,
  upsertAddressBookEntry,
} from '@/lib/safe/address-book';
import { useState } from 'react';
import { getAddress, isAddress } from 'viem';

export function SafeSettingsPanel({ account }: { account: SafeAccountConfig }) {
  const settings = useQuery({
    queryKey: ['safe-settings', account.address],
    queryFn: async () => {
      const res = await apiFetch(`/api/safe/${account.address}/settings`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? 'Failed to load settings');
      }
      return (await res.json()) as SafeOnChainSettings;
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const book = useSyncExternalStore(
    subscribeAddressBook,
    listAddressBook,
    () => EMPTY_ADDRESS_BOOK
  );
  const [newAddress, setNewAddress] = useState('');
  const [newLabel, setNewLabel] = useState('');

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <CuratorPanel title="Modules & guard" description="Read-only on-chain Safe configuration.">
        {settings.isLoading ? (
          <div className="p-4">
            <Skeleton className="h-24 w-full" />
          </div>
        ) : settings.error || !settings.data ? (
          <div className="px-4 py-3">
            <CuratorErrorText>
              {settings.error instanceof Error ? settings.error.message : 'Failed to load'}
            </CuratorErrorText>
          </div>
        ) : (
          <CuratorKvList>
            <CuratorKvRow label="Guard">
              {settings.data.guard ? (
                <AddressBadge address={settings.data.guard} truncate />
              ) : (
                <span className="text-muted-foreground">None</span>
              )}
            </CuratorKvRow>
            <CuratorKvRow label="Modules">
              {settings.data.modules.length === 0 ? (
                <span className="text-muted-foreground">None</span>
              ) : (
                <div className="flex flex-col items-end gap-1">
                  {settings.data.modules.map((m) => (
                    <AddressBadge key={m} address={m} truncate />
                  ))}
                </div>
              )}
            </CuratorKvRow>
          </CuratorKvList>
        )}
      </CuratorPanel>

      <CuratorPanel title="Address book" description="Saved recipients for Send (this browser).">
        <div className="space-y-3 p-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={newAddress}
              onChange={(e) => setNewAddress(e.target.value)}
              placeholder="0x…"
              className="font-mono text-xs"
            />
            <Input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="Label"
              className="text-xs"
            />
            <Button
              type="button"
              size="sm"
              disabled={!isAddress(newAddress.trim())}
              onClick={() => {
                upsertAddressBookEntry(getAddress(newAddress.trim()), newLabel);
                setNewAddress('');
                setNewLabel('');
              }}
            >
              Save
            </Button>
          </div>
          {book.length === 0 ? (
            <CuratorEmptyText>No saved recipients yet.</CuratorEmptyText>
          ) : (
            <ul className="divide-y divide-border">
              {book.map((row) => (
                <li key={row.address} className="flex items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <p className="text-sm text-foreground">{row.label}</p>
                    <AddressBadge address={row.address} truncate />
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => removeAddressBookEntry(row.address)}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CuratorPanel>
    </div>
  );
}
