/**
 * Top-level Curator IA areas. Topbar selects the area; Sidebar shows its subsections.
 */

export type CuratorNavArea =
  | 'overview'
  | 'vaults'
  | 'markets'
  | 'curator'
  | 'business';

export type CuratorNavItem = {
  id: CuratorNavArea;
  label: string;
  href: string;
};

export const CURATOR_TOP_NAV: readonly CuratorNavItem[] = [
  { id: 'overview', label: 'Overview', href: '/' },
  { id: 'vaults', label: 'Vaults', href: '/vaults' },
  { id: 'markets', label: 'Markets', href: '/markets' },
  { id: 'curator', label: 'Curator', href: '/curator' },
  { id: 'business', label: 'Business', href: '/monthly-statement' },
] as const;

/** Resolve which top-level area a pathname belongs to. */
export function resolveCuratorNavArea(pathname: string): CuratorNavArea {
  const path = pathname.split('?')[0] ?? pathname;

  if (
    path === '/vaults' ||
    path.startsWith('/vaults/') ||
    path.startsWith('/vault/')
  ) {
    return 'vaults';
  }

  if (
    path === '/markets' ||
    path.startsWith('/markets/') ||
    path.startsWith('/market/') ||
    path.startsWith('/midnight')
  ) {
    return 'markets';
  }

  if (
    path === '/curator' ||
    path.startsWith('/curator/') ||
    path === '/morpho' ||
    path.startsWith('/morpho/') ||
    path === '/safe' ||
    path.startsWith('/safe/')
  ) {
    return 'curator';
  }

  if (
    path.startsWith('/monthly-statement') ||
    path.startsWith('/muscadine-frontends')
  ) {
    return 'business';
  }

  return 'overview';
}

export function isTopNavActive(area: CuratorNavArea, pathname: string): boolean {
  return resolveCuratorNavArea(pathname) === area;
}
