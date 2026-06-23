'use client';

import { useEffect, useState } from 'react';
import {
  DEFAULT_FILTER_STATE,
  type AllocationFilterState,
} from '@/lib/allocation/allocation-filters';
import {
  loadAllocationFilters,
  saveAllocationFilters,
} from '@/lib/allocation/allocation-filters-storage';

export function usePersistedAllocationFilters(vaultAddress: string) {
  const [filters, setFilters] = useState<AllocationFilterState>(() =>
    loadAllocationFilters(vaultAddress)
  );

  useEffect(() => {
    setFilters(loadAllocationFilters(vaultAddress));
  }, [vaultAddress]);

  useEffect(() => {
    saveAllocationFilters(vaultAddress, filters);
  }, [vaultAddress, filters]);

  return [filters, setFilters] as const;
}
