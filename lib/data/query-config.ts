/** Poll active curator queries every 30s; refetch on mount and window focus. */
export const CURATOR_REFETCH_INTERVAL_MS = 30_000;

export const curatorQueryOptions = {
  staleTime: 0,
  refetchInterval: CURATOR_REFETCH_INTERVAL_MS,
  refetchOnWindowFocus: true,
} as const;
