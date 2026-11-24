import { useSyncExternalStore } from 'react';

/** True on the client after hydration; false during SSR. */
export function useIsClient(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
}
