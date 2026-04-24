'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Shield, X, FileText, BookOpen, LayoutGrid, Book, ChevronDown, ChevronRight, ArrowLeftRight } from 'lucide-react';
import { getVaultCategory, shouldUseV2Query } from '@/lib/config/vaults';
import { useVaultList } from '@/lib/hooks/useProtocolStats';
import { useCuratorAuth } from '@/lib/auth/CuratorAuthContext';
import { Button } from '@/components/ui/button';
import { SIDEBAR_NETWORKS } from '@/lib/constants';
import type { VaultWithData } from '@/lib/hooks/useProtocolStats';

const navBase = [
  { label: 'Overview', href: '/', icon: Shield },
];

type VaultSection = { type: 'vineyard' | 'prime' | 'v1'; label: string; vaults: VaultWithData[] };

function getSectionsForNetwork(vaults: VaultWithData[], chainId: number): VaultSection[] {
  const byChain = vaults.filter((v) => v.chainId === chainId);
  const sections: VaultSection[] = [];
  const prime = byChain.filter((v) => getVaultCategory(v.name, v.address) === 'prime');
  const vineyard = byChain.filter((v) => getVaultCategory(v.name, v.address) === 'vineyard');
  const v1 = byChain.filter((v) => getVaultCategory(v.name, v.address) === 'v1');
  if (vineyard.length > 0) sections.push({ type: 'vineyard', label: 'V2 Vineyard Vaults', vaults: vineyard });
  if (prime.length > 0) sections.push({ type: 'prime', label: 'V2 Prime Vaults', vaults: prime });
  if (v1.length > 0) sections.push({ type: 'v1', label: 'V1 Vaults', vaults: v1 });
  return sections;
}

type SidebarProps = {
  onClose?: () => void;
};

export function Sidebar({ onClose }: SidebarProps) {
  const pathname = usePathname();
  const { role } = useCuratorAuth();
  const { data: vaults = [], isLoading } = useVaultList();
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
          <img
            src="/muscadinelogo.jpg"
            alt="Muscadine"
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
                <span className="font-medium">
                  {network.name}
                </span>
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
                            const useV2Route =
                              section.type !== 'v1' && shouldUseV2Query(vault.name, vault.address);
                            const href =
                              section.type === 'v1'
                                ? `/vault/v1/${vault.address}`
                                : `/vault/${useV2Route ? 'v2' : 'v1'}/${vault.address}`;
                            const active =
                              section.type === 'v1'
                                ? isActive(`/vault/v1/${vault.address}`)
                                : isActive(`/vault/${useV2Route ? 'v2' : 'v1'}/${vault.address}`);

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
                                    section.type === 'v1'
                                      ? 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200'
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

        {role === 'owner' && (
          <div className="space-y-2">
            <p className="px-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Curator Tools
            </p>
            <div className="space-y-1">
              <Link
                href="/curator/morpho"
                onClick={handleLinkClick}
                className={`flex min-h-[44px] w-full touch-manipulation items-center gap-2 rounded-lg px-2 py-2 text-slate-700 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 ${
                  isActive('/curator/morpho') ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900' : ''
                }`}
              >
                <Shield className="h-4 w-4 shrink-0" />
                <span className="truncate min-w-0">Morpho</span>
              </Link>
              <Link
                href="/curator/frontend"
                onClick={handleLinkClick}
                className={`flex min-h-[44px] w-full touch-manipulation items-center gap-2 rounded-lg px-2 py-2 text-slate-700 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 ${
                  isActive('/curator/frontend') ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900' : ''
                }`}
              >
                <LayoutGrid className="h-4 w-4 shrink-0" />
                <span className="truncate min-w-0">Development</span>
              </Link>
              <Link
                href="/curator/safe"
                onClick={handleLinkClick}
                className={`flex min-h-[44px] w-full touch-manipulation items-center gap-2 rounded-lg px-2 py-2 text-slate-700 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 ${
                  isActive('/curator/safe') ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900' : ''
                }`}
              >
                <Shield className="h-4 w-4 shrink-0" />
                <span className="truncate min-w-0">Multisig Safe</span>
              </Link>
              <Link
                href="/curator/eip-7702"
                onClick={handleLinkClick}
                className={`flex min-h-[44px] w-full touch-manipulation items-center gap-2 rounded-lg px-2 py-2 text-slate-700 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 ${
                  isActive('/curator/eip-7702') ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900' : ''
                }`}
              >
                <BookOpen className="h-4 w-4 shrink-0" />
                <span className="truncate min-w-0">EIP-7702</span>
              </Link>
              <Link
                href="/curator/cctp"
                onClick={handleLinkClick}
                className={`flex min-h-[44px] w-full touch-manipulation items-center gap-2 rounded-lg px-2 py-2 text-slate-700 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 ${
                  isActive('/curator/cctp') ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900' : ''
                }`}
              >
                <ArrowLeftRight className="h-4 w-4 shrink-0" />
                <span className="truncate min-w-0">USDC Bridge (CCTP)</span>
              </Link>
            </div>
          </div>
        )}

        {role === 'owner' && (
          <div className="space-y-2">
            <p className="px-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Business
            </p>
            <div className="space-y-1">
              <Link
                href="/overview/monthly-statement"
                onClick={handleLinkClick}
                className={`flex min-h-[44px] w-full touch-manipulation items-center gap-2 rounded-lg px-2 py-2 text-slate-700 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 ${
                  isActive('/overview/monthly-statement') ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900' : ''
                }`}
              >
                <FileText className="h-4 w-4 shrink-0" />
                <span className="truncate min-w-0">Monthly Statement</span>
              </Link>
              <Link
                href="/overview/muscadine-ledger"
                onClick={handleLinkClick}
                className={`flex min-h-[44px] w-full touch-manipulation items-center gap-2 rounded-lg px-2 py-2 text-slate-700 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 ${
                  isActive('/overview/muscadine-ledger') ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900' : ''
                }`}
              >
                <Book className="h-4 w-4 shrink-0" />
                <span className="truncate min-w-0">Muscadine Ledger</span>
              </Link>
              <Link
                href="/overview/muscadine-frontends"
                onClick={handleLinkClick}
                className={`flex min-h-[44px] w-full touch-manipulation items-center gap-2 rounded-lg px-2 py-2 text-slate-700 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 ${
                  isActive('/overview/muscadine-frontends') ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900' : ''
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
