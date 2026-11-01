'use client';

import { Fragment, useEffect, useState } from 'react';
import { AlertTriangle, ExternalLink } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatAddress, formatCompactUSD, formatFullUSD } from '@/lib/format/number';
import { ExplorerAddressLink } from '@/components/morpho/ExplorerAddressLink';
import { MORPHO_ORACLE_PORTAL_URL } from '@/lib/constants/links';
import type {
  ChainlinkFeedSnapshot,
  OraclePriceSnapshot,
  OracleSourceSnapshot,
} from '@/lib/morpho/oracle-price';
import type { OracleTimestampData } from '@/lib/morpho/oracle-utils';
import {
  chainlinkFeedPageUrl,
  feedFreshness,
  feedName,
  feedProvider,
  feedTypeLabel,
  formatAgo,
  formatDurationShort,
  formatOraclePriceLine,
  oracleConstructionRows,
  oracleDeviationPct,
  oracleKindLabel,
  oracleProviders,
  wadToPct,
  type OracleConstructionRow,
} from '@/lib/morpho/oracle-display';
import { cn } from '@/lib/utils';

function Attr({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/60 py-1.5 text-sm last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium tabular-nums">{children}</span>
    </div>
  );
}

/** Feed answers are in the feed's own denomination (USD, ETH, BTC…), not always USD. */
function formatFeedAnswer(value: number | null, name: string | null): string {
  if (value == null) return '—';
  if (value > 1e30) return 'Infinite';
  const usd = name ? /\/\s*USD$/i.test(name) : false;
  const digits = Math.abs(value) >= 1000 ? 2 : Math.abs(value) >= 1 ? 4 : 8;
  const n = value.toLocaleString('en-US', { maximumFractionDigits: digits });
  return usd ? `$${n}` : n;
}

function boundsLabel(feed: ChainlinkFeedSnapshot, name: string | null): string | null {
  if (feed.minAnswerHuman == null && feed.maxAnswerHuman == null) return null;
  // Modern Chainlink aggregators ship min = 1 wei and max ≈ int192 max: no real bound.
  const noFloor =
    feed.minAnswer == null || BigInt(feed.minAnswer) <= 1n || (feed.minAnswerHuman ?? 0) <= 0;
  const noCeiling = feed.maxAnswerHuman == null || feed.maxAnswerHuman > 1e30;
  if (noFloor && noCeiling) return 'None';
  const min = noFloor ? '0' : formatFeedAnswer(feed.minAnswerHuman, name);
  const max = noCeiling ? '∞' : formatFeedAnswer(feed.maxAnswerHuman, name);
  return `${min} – ${max}`;
}

function sourceTitle(source: OracleSourceSnapshot, index: number): string {
  if (source.role === 'primary') return `Source ${index + 1} · Primary`;
  if (source.role === 'backup') return `Source ${index + 1} · Backup`;
  return 'Price construction';
}

function ConstructionRow({
  row,
  chainId,
  now,
  symbol,
}: {
  row: OracleConstructionRow;
  chainId: number;
  now: number;
  symbol: string;
}) {
  const cell = 'px-3 py-2 align-middle whitespace-nowrap';
  if (row.kind === 'fixed') {
    return (
      <tr className="border-t border-border/60">
        <td className={cell}>{symbol}</td>
        <td className={cell}>
          <Badge variant="secondary" className="text-[10px]">Fixed 1:1</Badge>
        </td>
        <td className={cn(cell, 'text-muted-foreground')} colSpan={5}>
          No feed — priced as one unit
        </td>
      </tr>
    );
  }
  if (row.kind === 'vault') {
    return (
      <tr className="border-t border-border/60">
        <td className={cell}>
          <ExplorerAddressLink address={row.address} chainId={chainId} />
        </td>
        <td className={cell}>
          <Badge variant="secondary" className="text-[10px]">ERC-4626 rate</Badge>
        </td>
        <td className={cn(cell, 'text-muted-foreground')} colSpan={5}>
          Vault share → asset conversion (<code>convertToAssets</code>)
        </td>
      </tr>
    );
  }

  const { feed } = row;
  const name = feedName(feed);
  const freshness = feedFreshness(feed, now);
  const reg = feed.registry;
  const pageUrl = reg ? chainlinkFeedPageUrl(reg, chainId) : null;
  const bounds = boundsLabel(feed, name);
  return (
    <tr className="border-t border-border/60">
      <td className={cell}>
        <div className="flex flex-col">
          {pageUrl ? (
            <a
              href={pageUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-medium hover:underline"
            >
              {name ?? formatAddress(feed.address)}
              <ExternalLink className="h-3 w-3" />
            </a>
          ) : (
            <span className="font-medium">{name ?? 'Unnamed feed'}</span>
          )}
          <ExplorerAddressLink address={feed.address} chainId={chainId} />
        </div>
      </td>
      <td className={cell}>
        <Badge variant="secondary" className="text-[10px]">{feedTypeLabel(feed)}</Badge>
      </td>
      <td className={cell}>
        <span className={cn(!reg && 'text-amber-600 dark:text-amber-400')}>
          {feedProvider(feed)}
        </span>
      </td>
      <td className={cn(cell, 'tabular-nums')}>
        {reg
          ? `${formatDurationShort(reg.heartbeatSeconds)} / ${
              reg.deviationPct != null ? `${reg.deviationPct}%` : '—'
            }`
          : '—'}
      </td>
      <td className={cn(cell, 'tabular-nums')}>
        <span
          className={cn(
            freshness === 'late' && 'font-medium text-red-600 dark:text-red-400'
          )}
        >
          {formatAgo(feed.updatedAt, now)}
        </span>
        {freshness === 'late' && (
          <Badge variant="destructive" className="ml-1 text-[10px]">Late</Badge>
        )}
      </td>
      <td className={cn(cell, 'text-right tabular-nums')}>
        {formatFeedAnswer(feed.answerHuman, name)}
      </td>
      <td className={cn(cell, 'text-right text-xs tabular-nums text-muted-foreground')}>
        {feed.atMinBound || feed.atMaxBound ? (
          <Badge variant="destructive" className="text-[10px]">
            {feed.atMinBound ? 'At min bound' : 'At max bound'}
          </Badge>
        ) : (
          bounds ?? '—'
        )}
      </td>
    </tr>
  );
}

function SourceTable({
  source,
  index,
  chainId,
  now,
  collateralSymbol,
  loanSymbol,
  showHeader,
}: {
  source: OracleSourceSnapshot;
  index: number;
  chainId: number;
  now: number;
  collateralSymbol: string;
  loanSymbol: string;
  showHeader: boolean;
}) {
  const rows = oracleConstructionRows(source);
  const priceLine = formatOraclePriceLine(source.loanPerCollateral, collateralSymbol, loanSymbol);
  const groups = [
    { side: 'collateral' as const, label: `Collateral · ${collateralSymbol}`, symbol: collateralSymbol },
    { side: 'loan' as const, label: `Loan · ${loanSymbol}`, symbol: loanSymbol },
  ];
  const head = 'px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap';

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium">{sourceTitle(source, index)}</p>
          {showHeader && source.active && <Badge className="text-[10px]">Active</Badge>}
          {showHeader && <ExplorerAddressLink address={source.address} chainId={chainId} />}
        </div>
        {priceLine && (
          <p className="text-xs tabular-nums text-muted-foreground">{priceLine}</p>
        )}
      </div>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr>
              <th className={head}>Feed</th>
              <th className={head}>Type</th>
              <th className={head}>Provider</th>
              <th className={head}>Heartbeat / Deviation</th>
              <th className={head}>Updated</th>
              <th className={cn(head, 'text-right')}>Latest price</th>
              <th className={cn(head, 'text-right')}>Bounds</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <Fragment key={g.side}>
                <tr className="border-t border-border bg-muted/20">
                  <td colSpan={7} className="px-3 py-1 text-xs text-muted-foreground">
                    {g.label}
                  </td>
                </tr>
                {rows[g.side].map((row, i) => (
                  <ConstructionRow
                    key={`${g.side}-${i}`}
                    row={row}
                    chainId={chainId}
                    now={now}
                    symbol={g.symbol}
                  />
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MetaOracleSection({
  oraclePrice,
  now,
}: {
  oraclePrice: OraclePriceSnapshot;
  now: number;
}) {
  const meta = oraclePrice.meta;
  if (!meta) return null;
  const active = oraclePrice.sources.find((s) => s.active);
  const deviation = wadToPct(meta.deviation);
  const threshold = wadToPct(meta.deviationThreshold);
  const until = (ts: number | null) =>
    ts == null ? '' : ts > now ? ` · ends in ${formatDurationShort(ts - now)}` : ' · timelock elapsed';

  return (
    <div className="space-y-1 rounded-xl border border-border px-3 py-2">
      <p className="text-xs font-medium text-muted-foreground">Primary / backup state</p>
      <Attr label="Pricing from">
        {oraclePrice.onBackup ? (
          <span className="text-amber-600 dark:text-amber-400">Backup</span>
        ) : meta.currentOracle ? (
          'Primary'
        ) : (
          '—'
        )}
        {!active && meta.currentOracle ? ' (source could not be decoded)' : ''}
      </Attr>
      <Attr label="Primary vs backup deviation">
        <span
          className={cn(
            deviation != null &&
              threshold != null &&
              deviation > threshold &&
              'text-red-600 dark:text-red-400'
          )}
        >
          {deviation != null ? `${deviation.toFixed(2)}%` : '—'}
          {threshold != null ? ` / ${threshold.toFixed(2)}% threshold` : ''}
        </span>
      </Attr>
      <Attr label="Challenge">
        {meta.isChallenged ? `Open${until(meta.challengeExpiresAt)}` : 'None'}
        {meta.challengeTimelockDuration != null &&
          ` (timelock ${formatDurationShort(meta.challengeTimelockDuration)})`}
      </Attr>
      <Attr label="Healing">
        {meta.isHealing ? `In progress${until(meta.healingExpiresAt)}` : 'None'}
        {meta.healingTimelockDuration != null &&
          ` (timelock ${formatDurationShort(meta.healingTimelockDuration)})`}
      </Attr>
    </div>
  );
}

export function MarketOraclePanel({
  collateralSymbol,
  loanSymbol,
  chainId,
  oraclePrice,
  oracleTimestampData,
  oracleCreatedAt,
  valueSecuredUsd,
}: {
  collateralSymbol: string;
  loanSymbol: string;
  chainId: number;
  oraclePrice: OraclePriceSnapshot | null;
  oracleTimestampData?: OracleTimestampData | null;
  /** Unix seconds, when Morpho indexed the oracle deployment. */
  oracleCreatedAt?: number | null;
  /** Collateral USD that this oracle prices. */
  valueSecuredUsd?: number | null;
}) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  // Keep ages, Late flags and timelock countdowns moving while the page is open.
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000);
    return () => clearInterval(id);
  }, []);

  if (!oraclePrice && !oracleTimestampData) return null;

  const sources = oraclePrice?.sources ?? [];
  const oracleAddress = oraclePrice?.oracleAddress ?? null;
  const priceLine = formatOraclePriceLine(
    oraclePrice?.loanPerCollateral,
    collateralSymbol,
    loanSymbol
  );
  const referenceLine =
    oraclePrice?.spotCollateralUsd != null && oraclePrice.spotLoanUsd
      ? formatOraclePriceLine(
          oraclePrice.spotCollateralUsd / oraclePrice.spotLoanUsd,
          collateralSymbol,
          loanSymbol
        )
      : null;
  const deviation = oracleDeviationPct(oraclePrice?.mismatchRatio);
  const providers = oracleProviders(sources);
  const allFeeds = sources.flatMap((s) => s.feeds);
  const lateFeeds = allFeeds.filter((f) => feedFreshness(f, now) === 'late');
  const unverifiedFeeds = allFeeds.filter((f) => !f.registry);
  const kind = oraclePrice?.kind ?? 'unknown';

  const alerts: string[] = [];
  if (oraclePrice?.feeds.some((f) => f.atMinBound || f.atMaxBound)) {
    alerts.push(
      'A feed is pinned to its min/max bound — the oracle cannot report below the floor or above the ceiling.'
    );
  }
  if (oraclePrice?.materialMismatch && deviation != null) {
    alerts.push(
      `Oracle price is ${Math.abs(deviation).toFixed(1)}% ${deviation > 0 ? 'above' : 'below'} the Morpho reference price.`
    );
  }
  if (lateFeeds.length > 0) {
    alerts.push(
      `${lateFeeds.length} feed${lateFeeds.length > 1 ? 's have' : ' has'} not updated within ${lateFeeds.length > 1 ? 'their' : 'its'} heartbeat.`
    );
  }
  // Same-asset pairs (USDC collateral / USDC loan) are 1:1 by construction.
  const hardcoded =
    collateralSymbol === loanSymbol
      ? []
      : sources.filter((s) => s.feeds.length === 0 && !s.baseVault && !s.quoteVault);
  for (const s of hardcoded) {
    alerts.push(
      `${s.role === 'single' ? 'This oracle' : `The ${s.role} source`}${s.active && s.role !== 'single' ? ' (active)' : ''} is hardcoded — it has no feeds and does not track the market price.`
    );
  }
  if (oraclePrice?.onBackup) alerts.push('This oracle is currently pricing from its backup source.');
  if (oraclePrice?.meta?.isChallenged) alerts.push('The primary source is under an open challenge.');
  if (kind === 'error') {
    alerts.push('Could not read the oracle contract (RPC error). Feeds will show after a refresh.');
  }
  if (kind === 'unknown' && oraclePrice) {
    alerts.push(
      'Oracle type not recognized — only the final price() is shown. Review the contract in the Oracle Decoder.'
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-base">Oracle</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={kind === 'unknown' ? 'destructive' : kind === 'error' ? 'outline' : 'secondary'}>
            {oracleKindLabel(kind)}
          </Badge>
          <a
            href={MORPHO_ORACLE_PORTAL_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            Oracle Decoder
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {alerts.length > 0 && (
          <div className="rounded-lg border border-amber-500/50 bg-amber-50 p-3 dark:bg-amber-950/20">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <ul className="space-y-1 text-xs text-amber-800 dark:text-amber-200">
                {alerts.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        <div className="grid gap-x-8 md:grid-cols-2">
          <div>
            <Attr label="Oracle contract">
              {oracleAddress ? <ExplorerAddressLink address={oracleAddress} chainId={chainId} /> : '—'}
            </Attr>
            <Attr label="Type">{oracleKindLabel(kind)}</Attr>
            <Attr label="Created">
              {oracleCreatedAt
                ? new Date(oracleCreatedAt * 1000).toISOString().slice(0, 10)
                : '—'}
            </Attr>
            <Attr label="Providers">
              {providers.length > 0 ? (
                <span className={cn(providers.includes('Unverified') && 'text-amber-600 dark:text-amber-400')}>
                  {providers.join(', ')}
                </span>
              ) : (
                '—'
              )}
            </Attr>
          </div>
          <div>
            <Attr label="Oracle price">{priceLine ?? '—'}</Attr>
            <Attr label="Reference price (Morpho)">{referenceLine ?? '—'}</Attr>
            <Attr label="Oracle vs reference">
              {deviation != null ? (
                <span
                  className={cn(
                    oraclePrice?.materialMismatch
                      ? 'text-red-600 dark:text-red-400'
                      : Math.abs(deviation) >= 1
                        ? 'text-amber-600 dark:text-amber-400'
                        : undefined
                  )}
                >
                  {deviation > 0 ? '+' : ''}
                  {deviation.toFixed(2)}%
                </span>
              ) : (
                '—'
              )}
            </Attr>
            <Attr label="Value secured">
              {valueSecuredUsd != null ? (
                <span title={formatFullUSD(valueSecuredUsd)}>{formatCompactUSD(valueSecuredUsd)}</span>
              ) : (
                '—'
              )}
            </Attr>
            <Attr label="Stalest feed">
              {oracleTimestampData?.updatedAt != null
                ? formatAgo(oracleTimestampData.updatedAt, now)
                : '—'}
            </Attr>
          </div>
        </div>

        {oraclePrice && <MetaOracleSection oraclePrice={oraclePrice} now={now} />}

        {sources.map((source, i) => (
          <SourceTable
            key={source.address}
            source={source}
            index={i}
            chainId={chainId}
            now={now}
            collateralSymbol={collateralSymbol}
            loanSymbol={loanSymbol}
            showHeader={sources.length > 1}
          />
        ))}

        {sources.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Oracle price = collateral side ÷ loan side × scale. Heartbeat and deviation come from
            Chainlink&apos;s feed directory
            {unverifiedFeeds.length > 0
              ? '; feeds marked Unverified are not Chainlink proxies on this chain — check who controls them'
              : ''}
            .
          </p>
        )}
      </CardContent>
    </Card>
  );
}
