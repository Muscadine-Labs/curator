'use client';

import { useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { KpiCard } from '@/components/KpiCard';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { TokenUsdValue } from '@/components/morpho/TokenUsdValue';
import { groupVaultsByKindAndCategory, getVaultPageHref } from '@/lib/config/vaults';
import { SIDEBAR_NETWORKS } from '@/lib/constants';
import {
  useProtocolStats,
  useVaultList,
  SIDEBAR_VAULT_LIST_FILTERS,
  type VaultWithData,
} from '@/lib/hooks/useProtocolStats';
import { formatPercentage } from '@/lib/format/number';
import { resolveTokenDisplayProps } from '@/lib/format/asset-decimals';
import { formatCapCompactAmount } from '@/lib/morpho/v2-cap-format';
import { cn } from '@/lib/utils';

function networkName(chainId: number): string {
  return SIDEBAR_NETWORKS.find((n) => n.chainId === chainId)?.name ?? `Chain ${chainId}`;
}

function liquiditySharePercent(vault: VaultWithData): number | null {
  try {
    const liq = BigInt(vault.liquidityUnderlying ?? '0');
    const total = BigInt(vault.totalAssetsUnderlying ?? '0');
    if (total === 0n) return null;
    return Number((liq * 10_000n) / total) / 100;
  } catch {
    return null;
  }
}

export function VaultsCatalog() {
  const { data: vaults = [], isLoading } = useVaultList(SIDEBAR_VAULT_LIST_FILTERS);
  const { data: stats, isLoading: statsLoading } = useProtocolStats();
  const [search, setSearch] = useState('');
  const [assetFilter, setAssetFilter] = useState<string | 'all'>('all');
  const [networkFilter, setNetworkFilter] = useState<number | 'all'>('all');

  const assets = useMemo(() => {
    const set = new Set<string>();
    for (const v of vaults) {
      if (v.asset) set.add(v.asset);
    }
    return [...set].sort();
  }, [vaults]);

  const networks = useMemo(() => {
    const ids = [...new Set(vaults.map((v) => v.chainId))];
    return SIDEBAR_NETWORKS.filter((n) => ids.includes(n.chainId));
  }, [vaults]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return vaults.filter((v) => {
      if (assetFilter !== 'all' && v.asset !== assetFilter) return false;
      if (networkFilter !== 'all' && v.chainId !== networkFilter) return false;
      if (!q) return true;
      const name = (v.name ?? '').toLowerCase();
      const addr = v.address.toLowerCase();
      const asset = (v.asset ?? '').toLowerCase();
      return name.includes(q) || addr.includes(q) || asset.includes(q);
    });
  }, [vaults, search, assetFilter, networkFilter]);

  const catalogVaults = useMemo(
    () => filtered.filter((v) => v.kind !== 'feeWrapper'),
    [filtered]
  );

  const groups = useMemo(
    () => groupVaultsByKindAndCategory(catalogVaults),
    [catalogVaults]
  );

  const depositsUsd = useMemo(
    () => catalogVaults.reduce((sum, v) => sum + (v.tvl ?? 0), 0),
    [catalogVaults]
  );

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <KpiCard
          title="Total deposits"
          value={depositsUsd}
          format="usd"
          isLoading={isLoading}
          subtitle="Underlying vaults. Fee wrappers are a tab on each vault."
        />
        <KpiCard
          title="Interest generated"
          value={stats?.totalInterestGenerated ?? null}
          format="usd"
          isLoading={statsLoading}
          subtitle="Protocol interest (all time)"
        />
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-wrap items-end gap-3">
          {networks.length > 0 ? (
            <div className="space-y-1">
              <label htmlFor="vault-network-filter" className="text-xs font-medium text-muted-foreground">
                Network
              </label>
              <select
                id="vault-network-filter"
                value={networkFilter === 'all' ? 'all' : String(networkFilter)}
                onChange={(e) => {
                  const value = e.target.value;
                  setNetworkFilter(value === 'all' ? 'all' : Number(value));
                }}
                className="h-9 min-w-[10rem] rounded-md border border-border bg-background px-3 text-sm"
              >
                <option value="all">All networks</option>
                {networks.map((n) => (
                  <option key={n.chainId} value={n.chainId}>
                    {n.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {assets.length > 1 ? (
            <div className="flex flex-wrap items-center gap-1">
              <FilterChip
                active={assetFilter === 'all'}
                onClick={() => setAssetFilter('all')}
              >
                Assets
              </FilterChip>
              {assets.map((asset) => (
                <FilterChip
                  key={asset}
                  active={assetFilter === asset}
                  onClick={() => setAssetFilter((prev) => (prev === asset ? 'all' : asset))}
                >
                  {asset}
                </FilterChip>
              ))}
            </div>
          ) : null}
        </div>
        <div className="relative w-full lg:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or address"
            className="pl-8"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">No vaults match these filters.</p>
      ) : (
        groups.map((kindGroup) => (
          <section key={kindGroup.kind} className="space-y-4">
            {kindGroup.categories.map((category) => (
              <div key={`${kindGroup.kind}-${category.category}`} className="space-y-2">
                <h3 className="text-sm font-medium text-muted-foreground">{category.label}</h3>
                <VaultTable vaults={category.vaults} />
              </div>
            ))}
          </section>
        ))
      )}
    </div>
  );
}

function VaultTable({ vaults }: { vaults: VaultWithData[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Network</TableHead>
            <TableHead>Vault</TableHead>
            <TableHead className="text-right">Total deposits</TableHead>
            <TableHead>Liquidity adapter</TableHead>
            <TableHead>Liquidity</TableHead>
            <TableHead className="text-right">APY</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {vaults.map((vault) => (
            <VaultRow key={vault.address} vault={vault} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors',
        active
          ? 'border-foreground/20 bg-muted text-foreground'
          : 'border-border text-muted-foreground hover:bg-muted/60'
      )}
    >
      {children}
    </button>
  );
}

function VaultRow({ vault }: { vault: VaultWithData }) {
  const router = useRouter();
  const href = getVaultPageHref(vault.address);
  const assetSymbol = vault.asset ?? 'UNKNOWN';
  const { chainDecimals, displayDecimals } = resolveTokenDisplayProps(
    assetSymbol,
    vault.assetDecimals
  );
  const adapter = vault.liquidityAdapter;
  const liqPct = liquiditySharePercent(vault);

  return (
    <TableRow
      className="cursor-pointer"
      onClick={() => router.push(href)}
    >
      <TableCell>
        <Badge variant="outline" className="text-[10px] font-normal">
          {networkName(vault.chainId)}
        </Badge>
      </TableCell>
      <TableCell>
        <Link href={href} className="min-w-0" onClick={(e) => e.stopPropagation()}>
          <span className="block truncate text-sm font-medium text-foreground">
            {vault.name ?? 'Unknown Vault'}
          </span>
          <span className="block font-mono text-[11px] text-muted-foreground">
            {vault.address.slice(0, 6)}…{vault.address.slice(-4)}
          </span>
        </Link>
      </TableCell>
      <TableCell className="text-right">
        <TokenUsdValue
          underlying={vault.totalAssetsUnderlying}
          usd={vault.tvl}
          assetSymbol={assetSymbol}
          chainDecimals={chainDecimals}
          displayDecimals={displayDecimals}
          compactUsd
          align="right"
        />
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm text-foreground">{adapter?.label ?? '—'}</span>
          {adapter?.utilizationPercent != null ? (
            <Badge variant="outline" className="text-[10px] font-normal tabular-nums">
              {formatPercentage(adapter.utilizationPercent, 0)}
            </Badge>
          ) : null}
        </div>
      </TableCell>
      <TableCell>
        {vault.liquidityUnderlying != null ? (
          <div>
            <p className="text-sm tabular-nums text-foreground">
              {formatCapCompactAmount(
                vault.liquidityUnderlying,
                assetSymbol,
                vault.assetDecimals
              )}
            </p>
            {liqPct != null ? (
              <p className="text-xs tabular-nums text-muted-foreground">
                {formatPercentage(liqPct, 2)}
              </p>
            ) : null}
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="text-right text-sm font-medium tabular-nums">
        {vault.apy != null ? formatPercentage(vault.apy, 2) : '—'}
      </TableCell>
    </TableRow>
  );
}
