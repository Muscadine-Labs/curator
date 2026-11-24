'use client';

import { useCallback, useSyncExternalStore } from 'react';
import {
  countPendingForRole,
  getSafePendingSnapshot,
  listPendingForRole,
  subscribeSafePending,
} from '@/lib/safe/pending-store';
import type { SafeRole } from '@/lib/safe/config';

export function useSafePendingCount(role: SafeRole): number {
  const getSnapshot = useCallback(() => countPendingForRole(role), [role]);
  return useSyncExternalStore(subscribeSafePending, getSnapshot, () => 0);
}

export function useSafePendingForRole(role: SafeRole) {
  const getSnapshot = useCallback(() => listPendingForRole(role), [role]);
  const getServerSnapshot = useCallback(() => [] as ReturnType<typeof listPendingForRole>, []);

  return useSyncExternalStore(subscribeSafePending, getSnapshot, getServerSnapshot);
}

export function useSafePendingTransactions() {
  const getSnapshot = useCallback(() => getSafePendingSnapshot(), []);
  const getServerSnapshot = useCallback(() => [] as ReturnType<typeof getSafePendingSnapshot>, []);

  return useSyncExternalStore(subscribeSafePending, getSnapshot, getServerSnapshot);
}
