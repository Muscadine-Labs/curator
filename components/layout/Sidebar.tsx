'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import {
  Book,
  FileText,
  LayoutGrid,
  LineChart,
  Shield,
  Users,
  Wrench,
  Bot,
  X,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import {
  getSidebarNavVaults,
  getVaultPageHref,
  groupVaultsByKindAndCategory,
  type SidebarNavVault,
} from '@/lib/config/vaults';
import { Button } from '@/components/ui/button';
import { SIDEBAR_NETWORKS } from '@/lib/constants';
import { resolveCuratorNavArea, type CuratorNavArea } from '@/lib/nav/areas';
import { cn } from '@/lib/utils';

type SidebarProps = {
  onClose?: () => void;
};

function kindGroupsForNetwork(vaults: SidebarNavVault[], chainId: number) {
  return groupVaultsByKindAndCategory(vaults.filter((v) => v.chainId === chainId));
}

function NavLink({
  href,
  label,
  icon: Icon,
  active,
  onClick,
}: {
  href: string;
  label: string;
  icon: typeof Shield;
  active: boolean;
  onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={cn(
        'flex min-h-[36px] w-full touch-manipulation items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition',
        active
          ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
          : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="truncate min-w-0">{label}</span>
    </Link>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
      {children}
    </p>
  );
}

export function Sidebar({ onClose }: SidebarProps) {
  const pathname = usePathname();
  const area = resolveCuratorNavArea(pathname);
  const vaults = useMemo(() => getSidebarNavVaults(), []);
  const [expandedNetworks, setExpandedNetworks] = useState<Set<number>>(
    () => new Set(SIDEBAR_NETWORKS.map((n) => n.chainId))
  );

  const isActive = (href: string) =>
    pathname === href || (href !== '/' && pathname.startsWith(href));

  const handleLinkClick = () => {
    onClose?.();
  };

  const toggleNetwork = (chainId: number) => {
    setExpandedNetworks((prev) => {
      const next = new Set(prev);
      if (next.has(chainId)) next.delete(chainId);
      else next.add(chainId);
      return next;
    });
  };

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-slate-200 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90">
      <div className="flex shrink-0 items-center justify-between border-b border-slate-200 p-4 dark:border-slate-800">
        <Link
          href="/"
          onClick={handleLinkClick}
          className="flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-slate-100"
        >
          <Image
            src="/muscadinelogo.jpg"
            alt="Muscadine"
            width={36}
            height={36}
            className="h-9 w-9 shrink-0 rounded-xl object-cover"
          />
          Curator
        </Link>
        {onClose && (
          <Button
            variant="ghost"
            size="icon"
            className="min-h-[44px] min-w-[44px] touch-manipulation lg:hidden"
            onClick={onClose}
          >
            <X className="h-5 w-5" />
          </Button>
        )}
      </div>

      <nav className="flex-1 space-y-4 overflow-y-auto p-4 text-sm touch-manipulation">
        <AreaSidebar
          area={area}
          pathname={pathname}
          isActive={isActive}
          onLinkClick={handleLinkClick}
          vaults={vaults}
          expandedNetworks={expandedNetworks}
          toggleNetwork={toggleNetwork}
        />
      </nav>
    </aside>
  );
}

function AreaSidebar({
  area,
  pathname,
  isActive,
  onLinkClick,
  vaults,
  expandedNetworks,
  toggleNetwork,
}: {
  area: CuratorNavArea;
  pathname: string;
  isActive: (href: string) => boolean;
  onLinkClick: () => void;
  vaults: SidebarNavVault[];
  expandedNetworks: Set<number>;
  toggleNetwork: (chainId: number) => void;
}) {
  if (area === 'overview') {
    return (
      <div className="space-y-1">
        <SectionLabel>Overview</SectionLabel>
        <NavLink
          href="/"
          label="Protocol"
          icon={Shield}
          active={pathname === '/'}
          onClick={onLinkClick}
        />
      </div>
    );
  }

  if (area === 'vaults') {
    return (
      <div className="space-y-4">
        <div className="space-y-1">
          <SectionLabel>Vaults</SectionLabel>
          <NavLink
            href="/vaults"
            label="All vaults"
            icon={LayoutGrid}
            active={pathname === '/vaults'}
            onClick={onLinkClick}
          />
        </div>

        {SIDEBAR_NETWORKS.filter(
          (network) => kindGroupsForNetwork(vaults, network.chainId).length > 0
        ).map((network) => {
          const kindGroups = kindGroupsForNetwork(vaults, network.chainId);
          const isExpanded = expandedNetworks.has(network.chainId);
          return (
            <div key={network.chainId} className="space-y-1">
              <button
                type="button"
                onClick={() => toggleNetwork(network.chainId)}
                className="flex min-h-[36px] w-full cursor-pointer touch-manipulation items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-slate-700 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4 shrink-0" />
                ) : (
                  <ChevronRight className="h-4 w-4 shrink-0" />
                )}
                <span className="font-medium">{network.name}</span>
              </button>
              {isExpanded && (
                <div className="ml-3 space-y-3 border-l border-slate-200 pl-2 dark:border-slate-700">
                  {kindGroups.map((kindGroup) => (
                      <div key={kindGroup.kind} className="space-y-1.5">
                        {kindGroups.length > 1 ? (
                          <SectionLabel>{kindGroup.label}</SectionLabel>
                        ) : null}
                        {kindGroup.categories.map((category) => (
                          <div key={`${kindGroup.kind}-${category.category}`} className="space-y-0.5">
                            <p className="px-2 text-[10px] font-medium text-slate-500 dark:text-slate-400">
                              {category.label}
                            </p>
                            {category.vaults.map((vault) => {
                              const href = getVaultPageHref(vault.address);
                              const active = isActive(href);
                              return (
                                <Link
                                  key={vault.address}
                                  href={href}
                                  onClick={onLinkClick}
                                  className={cn(
                                    'flex min-h-[36px] w-full touch-manipulation items-center rounded-lg px-2 py-1.5 text-sm transition',
                                    active
                                      ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                                      : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                                  )}
                                >
                                  <span className="truncate min-w-0">{vault.name}</span>
                                </Link>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  if (area === 'markets') {
    return (
      <div className="space-y-1">
        <SectionLabel>Markets</SectionLabel>
        <NavLink
          href="/markets"
          label="Browse"
          icon={LineChart}
          active={pathname === '/markets' || pathname.startsWith('/market/') || pathname.startsWith('/midnight')}
          onClick={onLinkClick}
        />
      </div>
    );
  }

  if (area === 'curator') {
    return (
      <div className="space-y-1">
        <SectionLabel>Curator</SectionLabel>
        <NavLink
          href="/curator"
          label="Curator tools"
          icon={Wrench}
          active={pathname === '/curator'}
          onClick={onLinkClick}
        />
        <NavLink
          href="/curator/bots"
          label="Bots"
          icon={Bot}
          active={isActive('/curator/bots')}
          onClick={onLinkClick}
        />
        <NavLink
          href="/curator/gates"
          label="Send-assets gate"
          icon={Shield}
          active={isActive('/curator/gates')}
          onClick={onLinkClick}
        />
        <NavLink
          href="/safe"
          label="Multisig Safe"
          icon={Users}
          active={isActive('/safe')}
          onClick={onLinkClick}
        />
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <SectionLabel>Business</SectionLabel>
      <NavLink
        href="/monthly-statement"
        label="Monthly Statement"
        icon={FileText}
        active={isActive('/monthly-statement')}
        onClick={onLinkClick}
      />
      <NavLink
        href="/muscadine-ledger"
        label="Muscadine Ledger"
        icon={Book}
        active={isActive('/muscadine-ledger')}
        onClick={onLinkClick}
      />
      <NavLink
        href="/muscadine-frontends"
        label="Muscadine Pages"
        icon={LayoutGrid}
        active={isActive('/muscadine-frontends')}
        onClick={onLinkClick}
      />
    </div>
  );
}
