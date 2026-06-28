import type { ReactNode } from 'react';
import { formatMarketPairLabel } from '@/components/morpho/AllocationListView';
import type { CapInfo } from '@/app/api/vaults/[id]/governance/route';
import { isCollateralCap, isMarketCap } from '@/lib/morpho/cap-utils';
import { morphoMarketHref } from '@/lib/morpho/morpho-app-links';
import { getScanUrlForChain } from '@/lib/constants';

const capLinkClass = 'text-blue-600 hover:underline dark:text-blue-400';

function ScanTokenLink({
  address,
  children,
  scanBase,
}: {
  address: string | null | undefined;
  children: ReactNode;
  scanBase: string;
}) {
  if (!address) return <span>{children}</span>;
  return (
    <a
      href={`${scanBase}/token/${address}`}
      target="_blank"
      rel="noreferrer"
      className={capLinkClass}
    >
      {children}
    </a>
  );
}

export function CapLabel({
  cap,
  label,
  chainId,
}: {
  cap: CapInfo;
  label: string;
  chainId: number;
}) {
  const scanBase = getScanUrlForChain(chainId);

  if (isCollateralCap(cap) && cap.collateralAddress) {
    return (
      <ScanTokenLink address={cap.collateralAddress} scanBase={scanBase}>
        {label}
      </ScanTokenLink>
    );
  }

  if (isMarketCap(cap) && cap.marketKey) {
    const morphoHref = morphoMarketHref(cap.marketKey, chainId);
    const col = cap.marketParams?.collateralAsset;
    const loan = cap.marketParams?.loanAsset;

    if (col?.address && loan?.address) {
      const colLabel = col.symbol ?? 'Collateral';
      const loanLabel = loan.symbol ?? 'Loan';
      return (
        <span className="inline-flex flex-wrap items-center gap-1">
          <ScanTokenLink address={col.address} scanBase={scanBase}>
            {colLabel}
          </ScanTokenLink>
          <span className="text-slate-500 dark:text-slate-400">/</span>
          <ScanTokenLink address={loan.address} scanBase={scanBase}>
            {loanLabel}
          </ScanTokenLink>
          {morphoHref ? (
            <a
              href={morphoHref}
              target="_blank"
              rel="noreferrer"
              className="ml-1 text-xs font-normal text-slate-500 hover:text-blue-600 hover:underline dark:text-slate-400 dark:hover:text-blue-400"
              title="View market on Morpho"
            >
              Morpho ↗
            </a>
          ) : null}
        </span>
      );
    }

    if (morphoHref) {
      return (
        <a href={morphoHref} target="_blank" rel="noreferrer" className={capLinkClass}>
          {label || formatMarketPairLabel(col?.symbol, loan?.symbol)}
        </a>
      );
    }
  }

  return <span>{label}</span>;
}
