'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { Shield, X, FileText, LayoutGrid, Book, ChevronDown, ChevronRight, LineChart, Users, Wrench } from 'lucide-react';
import { getVaultCategory } from '@/lib/config/vaults';
import { useVaultList, SIDEBAR_VAULT_LIST_FILTERS } from '@/lib/hooks/useProtocolStats';
import { useCuratorAuth } from '@/lib/auth/CuratorAuthContext';
import { Button } from '@/components/ui/button';
import { SIDEBAR_NETWORKS } from '@/lib/constants';
import type { VaultWithData } from '@/lib/hooks/useProtocolStats';

const navBase = [
  { label: 'Overview', href: '/', icon: Shield },
];

type VaultSectionType = 'prime' | 'frontier' | 'vineyard' | 'test';

type VaultSection = { type: VaultSectionType; label: string; vaults: VaultWithData[] };

const SECTION_ORDER: VaultSectionType[] = ['prime', 'frontier', 'vineyard', 'test'];

const SECTION_LABELS: Record<VaultSectionType, string> = {
  prime: 'V2 Prime Vaults',
  frontier: 'V2 Frontier Vaults',
  vineyard: 'V2 Vineyard Vaults',
  test: 'V2 Test',
};

function vaultSectionType(vault: VaultWithData): VaultSectionType {
  if (
    vault.listCategory === 'prime' ||
    vault.listCategory === 'frontier' ||
    vault.listCategory === 'vineyard' ||
    vault.listCategory === 'test'
  ) {
    return vault.listCategory;
  }
  const cat = getVaultCategory(vault.name, vault.address);
  if (cat === 'frontier' || cat === 'vineyard') return cat;
  return 'prime';
}

function getSectionsForNetwork(vaults: VaultWithData[], chainId: number): VaultSection[] {
  const byChain = vaults.filter((v) => v.chainId === chainId);
  const sections: VaultSection[] = [];

  for (const type of SECTION_ORDER) {
    const matched = byChain.filter((v) => vaultSectionType(v) === type);
    if (matched.length > 0) {
      sections.push({ type, label: SECTION_LABELS[type], vaults: matched });
    }
  }

  return sections;
}

type SidebarProps = {
  onClose?: () => void;
};

export function Sidebar({ onClose }: SidebarProps) {
  const pathname = usePathname();
  const { role } = useCuratorAuth();
  const { data: vaults = [], isLoading } = useVaultList(SIDEBAR_VAULT_LIST_FILTERS);
  const [expandedNetworks, setExpandedNetworks] = useState<Set<number>>(() =>
    new Set(SIDEBAR_NETWORKS.map((n) => n.chainId))
  );

  const isActive = (href: string) =>
    pathname === href || (href !== '/' && pathname.startsWith(href));

  const handleLinkClick = () => {
    if (onClose) onClose();
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

      <nav className="flex-1 space-y-6 overflow-y-auto p-4 text-sm touch-manipulation">
        <div className="space-y-1">
          <p className="px-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Explore
          </p>
          {navBase.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={handleLinkClick}
              className={`flex min-h-[44px] w-full touch-manipulation items-center gap-2 rounded-lg px-2 py-2 transition ${
                isActive(item.href)
                  ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                  : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {item.label}
            </Link>
          ))}
        </div>

        {SIDEBAR_NETWORKS.filter(
          (network) => getSectionsForNetwork(vaults, network.chainId).length > 0
        ).map((network) => {
          const sections = getSectionsForNetwork(vaults, network.chainId);
          const isExpanded = expandedNetworks.has(network.chainId);

          return (
            <div key={network.chainId} className="space-y-1">
              <button
                type="button"
                onClick={() => toggleNetwork(network.chainId)}
                className="flex min-h-[44px] w-full cursor-pointer touch-manipulation items-center gap-2 rounded-lg px-2 py-2 text-left text-slate-700 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4 shrink-0" />
                ) : (
                  <ChevronRight className="h-4 w-4 shrink-0" />
                )}
                <span className="font-medium">{network.name}</span>
              </button>
              {isExpanded && (
                <div className="ml-4 space-y-4 border-l border-slate-200 pl-2 dark:border-slate-700">
                  {isLoading ? (
                    <div className="px-2 py-2 text-slate-500 dark:text-slate-400">Loading...</div>
                  ) : (
                    sections.map((section) => (
                      <div key={section.type} className="space-y-2">
                        <p className="px-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          {section.label}
                        </p>
                        <div className="space-y-1">
                          {section.vaults.map((vault) => {
                            const href = `/vault/${vault.address}`;
                            const active = isActive(href);

                            return (
                              <Link
                                key={vault.address}
                                href={href}
                                onClick={handleLinkClick}
                                className={`flex min-h-[44px] w-full touch-manipulation items-center gap-2 rounded-lg px-2 py-2 text-slate-700 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 ${
                                  active
                                    ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                                    : ''
                                }`}
                              >
                                <span
                                  className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                                    section.type === 'frontier'
                                      ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300'
                                      : 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300'
                                  }`}
                                >
                                  {(vault.asset ?? 'U').slice(0, 1)}
                                </span>
                                <span className="truncate min-w-0">{vault.name ?? 'Unknown Vault'}</span>
                              </Link>
                            );
                          })}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          );
        })}

        {role === 'admin' && (
          <div className="space-y-2">
            <p className="px-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Curator Tools
            </p>
            <div className="space-y-1">
              <Link
                href="/markets"
                onClick={handleLinkClick}
                className={`flex min-h-[44px] w-full touch-manipulation items-center gap-2 rounded-lg px-2 py-2 text-slate-700 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 ${
                  isActive('/markets') || pathname.startsWith('/market/')
                    ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                    : ''
                }`}
              >
                <LineChart className="h-4 w-4 shrink-0" />
                <span className="truncate min-w-0">Morpho Markets</span>
              </Link>
              <Link
                href="/safe"
                onClick={handleLinkClick}
                className={`flex min-h-[44px] w-full touch-manipulation items-center gap-2 rounded-lg px-2 py-2 text-slate-700 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 ${
                  isActive('/safe') || pathname.startsWith('/safe/')
                    ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                    : ''
                }`}
              >
                <Users className="h-4 w-4 shrink-0" />
                <span className="truncate min-w-0">Multisig Safe</span>
              </Link>
              <Link
                href="/morpho"
                onClick={handleLinkClick}
                className={`flex min-h-[44px] w-full touch-manipulation items-center gap-2 rounded-lg px-2 py-2 text-slate-700 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 ${
                  isActive('/morpho') || pathname.startsWith('/morpho/')
                    ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                    : ''
                }`}
              >
                <Wrench className="h-4 w-4 shrink-0" />
                <span className="truncate min-w-0">Morpho Tools</span>
              </Link>
            </div>
          </div>
        )}

        {role === 'admin' && (
          <div className="space-y-2">
            <p className="px-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Business
            </p>
            <div className="space-y-1">
              <Link
                href="/monthly-statement"
                onClick={handleLinkClick}
                className={`flex min-h-[44px] w-full touch-manipulation items-center gap-2 rounded-lg px-2 py-2 text-slate-700 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 ${
                  isActive('/monthly-statement') ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900' : ''
                }`}
              >
                <FileText className="h-4 w-4 shrink-0" />
                <span className="truncate min-w-0">Monthly Statement</span>
              </Link>
              <Link
                href="/muscadine-ledger"
                onClick={handleLinkClick}
                className={`flex min-h-[44px] w-full touch-manipulation items-center gap-2 rounded-lg px-2 py-2 text-slate-700 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 ${
                  isActive('/muscadine-ledger') ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900' : ''
                }`}
              >
                <Book className="h-4 w-4 shrink-0" />
                <span className="truncate min-w-0">Muscadine Ledger</span>
              </Link>
              <Link
                href="/muscadine-frontends"
                onClick={handleLinkClick}
                className={`flex min-h-[44px] w-full touch-manipulation items-center gap-2 rounded-lg px-2 py-2 text-slate-700 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 ${
                  isActive('/muscadine-frontends') ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900' : ''
                }`}
              >
                <LayoutGrid className="h-4 w-4 shrink-0" />
                <span className="truncate min-w-0">Muscadine Pages</span>
              </Link>
            </div>
          </div>
        )}
      </nav>
    </aside>
  );
}
