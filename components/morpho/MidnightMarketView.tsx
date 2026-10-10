'use client';

import type { ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatPercentage } from '@/lib/format/number';
import { formatMarketTokenAmount } from '@/components/morpho/TokenUsdValue';
import { MarketOraclePanel } from '@/components/morpho/MarketOraclePanel';
import {
  formatLltvWad,
  formatMidnightMaturityUtc,
  formatWadPercent,
  isTenorCollateralShare,
  midnightLiquidationIncentive,
  type MidnightBookLevelView,
  type MidnightMarketDetail,
} from '@/lib/morpho/midnight-markets';
import { BASE_CHAIN_ID, getAddressScanUrl, getScanNameForChain } from '@/lib/constants';
import { bigintRatio } from '@/lib/format/bigint-ratio';
import { getAddress, isAddress } from 'viem';
import { CuratorTableShell } from '@/components/morpho/CuratorChrome';

function formatPriceWad(priceWad: string): string {
  try {
    const n = bigintRatio(BigInt(priceWad), 10n ** 18n);
    if (!Number.isFinite(n)) return '—';
    return n.toFixed(6);
  } catch {
    return '—';
  }
}

function AddrLink({
  address,
  chainId,
  label,
}: {
  address: string;
  chainId: number;
  label?: string;
}) {
  if (!isAddress(address)) {
    return <span className="font-mono text-xs break-all">{address}</span>;
  }
  const checksum = getAddress(address);
  const href = getAddressScanUrl(chainId, checksum);
  const short = `${checksum.slice(0, 6)}…${checksum.slice(-4)}`;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 font-mono text-xs text-blue-700 hover:underline dark:text-blue-400"
    >
      {label ?? short}
      <ExternalLink className="h-3 w-3" />
    </a>
  );
}

function Metric({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="font-medium">{children}</div>
    </div>
  );
}

function BookSide({
  title,
  levels,
  loanSymbol,
  loanDecimals,
  emptyLabel,
}: {
  title: string;
  levels: MidnightBookLevelView[];
  loanSymbol: string;
  loanDecimals: number;
  emptyLabel: string;
}) {
  let running = 0n;
  return (
    <CuratorTableShell>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead colSpan={5} className="text-xs font-semibold">
              {title}
            </TableHead>
          </TableRow>
          <TableRow>
            <TableHead>Rate</TableHead>
            <TableHead>Price</TableHead>
            <TableHead className="text-right">Amount ({loanSymbol})</TableHead>
            <TableHead className="text-right">Total ({loanSymbol})</TableHead>
            <TableHead className="text-right">Orders</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {levels.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                {emptyLabel}
              </TableCell>
            </TableRow>
          ) : (
            levels.map((level, i) => {
              try {
                running += BigInt(level.assets);
              } catch {
                // skip
              }
              const total = running.toString();
              return (
                <TableRow key={`${level.tick}-${i}`}>
                  <TableCell className="tabular-nums">
                    {level.rate != null ? formatPercentage(level.rate * 100) : '—'}
                  </TableCell>
                  <TableCell className="tabular-nums text-xs text-muted-foreground">
                    {formatPriceWad(level.priceWad)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMarketTokenAmount(level.assets, loanSymbol, loanDecimals) ?? '—'}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMarketTokenAmount(total, loanSymbol, loanDecimals) ?? '—'}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{level.count}</TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </CuratorTableShell>
  );
}

export function MidnightMarketView({ market }: { market: MidnightMarketDetail }) {
  const scanName = getScanNameForChain(market.chainId);
  const maturityUtc = formatMidnightMaturityUtc(market.maturity);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Market details</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Midnight is a fixed-term order book. Filled size is outstanding
              credit in the loan token. Lender credit and borrower debt are
              summed from positions. Open offers are still on the book.
            </p>
          </div>
          <Badge variant="secondary">Fixed rate</Badge>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Loan">{market.loanSymbol}</Metric>
          <Metric label="Collateral">{market.collateralLabel}</Metric>
          <Metric label="LLTV">{market.lltvLabel}</Metric>
          <Metric label="Maturity (UTC)">
            <div>{maturityUtc}</div>
            <p className="text-xs font-normal text-muted-foreground">
              {market.tenorLabel} remaining
            </p>
          </Metric>
          <Metric label="Filled size">
            {formatMarketTokenAmount(
              market.totalUnits,
              market.loanSymbol,
              market.loanDecimals
            ) ?? '—'}
          </Metric>
          <Metric label="Lender credit">
            {formatMarketTokenAmount(
              market.lenderCredit,
              market.loanSymbol,
              market.loanDecimals
            ) ?? '—'}
            {market.lenderCredit != null ? (
              <p className="text-xs font-normal text-muted-foreground">
                {market.lendPositionCount} lending
              </p>
            ) : null}
          </Metric>
          <Metric label="Borrower debt">
            {formatMarketTokenAmount(
              market.borrowerDebt,
              market.loanSymbol,
              market.loanDecimals
            ) ?? '—'}
            {market.borrowerDebt != null ? (
              <p className="text-xs font-normal text-muted-foreground">
                {market.borrowPositionCount} borrowing
              </p>
            ) : null}
          </Metric>
          <Metric label="Open lend offers">
            {formatMarketTokenAmount(
              market.lendDepthAssets,
              market.loanSymbol,
              market.loanDecimals
            ) ?? '—'}
          </Metric>
          <Metric label="Open borrow offers">
            {formatMarketTokenAmount(
              market.borrowDepthAssets,
              market.loanSymbol,
              market.loanDecimals
            ) ?? '—'}
          </Metric>
          <Metric label="Best lend rate">
            {market.bestLendRate != null
              ? formatPercentage(market.bestLendRate * 100)
              : '—'}
          </Metric>
          <Metric label="Best borrow rate">
            {market.bestBorrowRate != null
              ? formatPercentage(market.bestBorrowRate * 100)
              : '—'}
          </Metric>
          <Metric label="Tick granularity">
            {market.tickGranularity != null ? market.tickGranularity : '—'}
          </Metric>
          <Metric label="RCF threshold">
            {formatMarketTokenAmount(
              market.rcfThreshold,
              market.loanSymbol,
              market.loanDecimals
            ) ?? '—'}
          </Metric>
          <Metric label="Settlement fee">
            {market.currentSettlementFeeCbp != null && market.currentSettlementFeeCbp !== '0'
              ? `${market.currentSettlementFeeCbp} cbp`
              : 'None'}
          </Metric>
        </CardContent>
      </Card>

      {market.collaterals.map((c) => {
        const incentive = midnightLiquidationIncentive(c.lltv, c.liquidationCursor);
        const showOraclePanel = Boolean(c.oraclePrice || c.oracleTimestampData);
        const sameAsLoan = c.token.toLowerCase() === market.loanAddress.toLowerCase();
        const tenorShare = isTenorCollateralShare(c.symbol);
        const title = sameAsLoan
          ? `Also accepted · ${c.symbol}`
          : tenorShare
            ? `Tenor vault share · ${c.symbol}`
            : `Collateral ${c.symbol}`;
        return (
        <div key={`${c.token}-${c.oracle}`} className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{title}</CardTitle>
            {sameAsLoan ? (
              <p className="text-xs text-muted-foreground">
                Same token as the debt. Posted amount is what borrowers actually
                deposited, which is separate from the loan outstanding.
              </p>
            ) : tenorShare ? (
              <p className="text-xs text-muted-foreground">
                Receipt for collateral held in Midnight&apos;s Tenor vault. Not a
                second asset, and not USDC posted as collateral.
              </p>
            ) : null}
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Posted">
              {formatMarketTokenAmount(c.postedAssets, c.symbol, c.decimals) ?? '—'}
            </Metric>
            <Metric label="LLTV">{formatLltvWad(c.lltv)}</Metric>
            <Metric label="Liquidation cursor">
              {formatWadPercent(c.liquidationCursor)}
            </Metric>
            <Metric label="Liquidation incentive">
              {incentive != null ? formatPercentage(incentive * 100) : '—'}
            </Metric>
            {!showOraclePanel ? (
              <Metric label={`Oracle (${scanName})`}>
                {c.oracle ? (
                  <AddrLink address={c.oracle} chainId={market.chainId} />
                ) : (
                  '—'
                )}
              </Metric>
            ) : null}
            <div className="sm:col-span-2">
              <p className="text-xs text-muted-foreground">Token</p>
              <AddrLink address={c.token} chainId={market.chainId} />
            </div>
          </CardContent>
        </Card>

        {showOraclePanel ? (
          <MarketOraclePanel
            collateralSymbol={c.symbol}
            loanSymbol={market.loanSymbol}
            chainId={market.chainId}
            oraclePrice={c.oraclePrice ?? null}
            oracleTimestampData={c.oracleTimestampData}
          />
        ) : market.chainId !== BASE_CHAIN_ID && c.oracle ? (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">
              Oracle freshness, feed bounds, and price reads use the{' '}
              <span className="font-medium text-foreground">Base RPC</span> only today.
              Add a {scanName} RPC to enable the full oracle panel on this network.
            </CardContent>
          </Card>
        ) : null}
        </div>
        );
      })}

      <div className="grid gap-4 lg:grid-cols-2">
        <BookSide
          title="Asks · lend"
          levels={market.asks}
          loanSymbol={market.loanSymbol}
          loanDecimals={market.loanDecimals}
          emptyLabel="No lend offers on the book."
        />
        <BookSide
          title="Bids · borrow"
          levels={market.bids}
          loanSymbol={market.loanSymbol}
          loanDecimals={market.loanDecimals}
          emptyLabel="No borrow offers on the book."
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Protocol</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs text-muted-foreground">Market ID</p>
            <p className="break-all font-mono text-xs text-foreground">
              {market.marketId}
            </p>
          </div>
          {market.marketFamilyId ? (
            <div>
              <p className="text-xs text-muted-foreground">Market family</p>
              <p className="break-all font-mono text-xs text-foreground">
                {market.marketFamilyId}
              </p>
            </div>
          ) : null}
          <div>
            <p className="text-xs text-muted-foreground">Loan token</p>
            <AddrLink address={market.loanAddress} chainId={market.chainId} />
          </div>
          {market.midnight ? (
            <div>
              <p className="text-xs text-muted-foreground">Midnight contract</p>
              <AddrLink address={market.midnight} chainId={market.chainId} />
            </div>
          ) : null}
          <Metric label="Enter gate">
            {market.enterGate ? (
              <AddrLink address={market.enterGate} chainId={market.chainId} />
            ) : (
              'None'
            )}
          </Metric>
          <Metric label="Liquidator gate">
            {market.liquidatorGate ? (
              <AddrLink address={market.liquidatorGate} chainId={market.chainId} />
            ) : (
              'None'
            )}
          </Metric>
          {market.lastIndexedBlock ? (
            <Metric label="Last indexed block">{market.lastIndexedBlock}</Metric>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
