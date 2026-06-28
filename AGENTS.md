# AGENTS.md — Working Instructions for AI Assistants

This file is the quick-start contract for any AI agent working in this repo.
The full architecture reference lives in **`CLAUDE.md`** — read it before
touching vault mechanics, allocations, Morpho GraphQL queries, or formatting.

## Session checklist

1. **Read `TODO.md` first.** It is the running task list for the repo. Work the
   "TO work on today" section top-to-bottom unless directed otherwise. Items
   under "To work on another day" are out of scope unless explicitly requested.
2. **Read the relevant sections of `CLAUDE.md`** (especially §3 vault mental
   model and §5 reallocation UX conventions) before changing allocation logic.
3. After substantive changes, run and pass:

```bash
npm run lint    # eslint . --max-warnings=0 (ESLint 9 + eslint-config-next — see CLAUDE.md §11)
npm run build   # next build
```

## Key invariants (do not regress)

- **Auth:** the only login username is `admin` (role `'admin'`); password from
  `CURATOR_ADMIN_PASSWORD` (legacy `CURATOR_OWNER_PASSWORD` accepted).
- **V2-only vault config:** all tracked vaults are Morpho V2 (`lib/config/vaults.ts`).
  No MetaMorpho / V1 vault routes. Blue market risk uses `blue-market-data.ts` +
  `compute-blue-market-risk.ts`. MetaMorpho adapters are ignored in risk, allocation,
  and sentinel UIs.
- **React Query polling** — dashboard hooks poll every 30s; indexed vault data
  (history, reallocations, holders) does not background-poll. On-chain vault
  hooks (`risk`, `governance`) use `staleTime: 0` + `refetchOnMount: 'always'`.
  See `lib/data/query-config.ts`.
- **V2 allocate/deallocate** is delta-based; idle is never in calldata;
  unallocated remainder defaults to implicit Idle, with an optional explicit
  dust recipient (cap-validated).
- **V2 cap `idData` ≠ deallocate `data`:** cap writes use prefixed ABI encoding
  (`"this"`, `"collateralToken"`, `"this/marketParams"`) via `lib/morpho/v2-id-data.ts`;
  allocate/deallocate adapter `data` is `encodeMarketParamsData(market)` for Morpho
  Blue markets only. Never pass bare addresses or raw MarketParams as cap `idData`.
- **V2 vault tabs** (order on vault page): Overview → **Risk** → Roles → Adapters →
  Caps → Timelocks → Allocation → Sentinel → Emergency. Pending actions embed in Caps;
  Sentinel is the only tab with sentinel writes (decrease caps, deallocate).
- **Tx preview** — Allocation and Sentinel confirm writes through
  `TxPreviewDialog` + `lib/morpho/tx-preview.ts` before the wallet signs.
- **V2 pending revoke** — per-row `rowId` + `activeRowId`; never key tx state by
  `item.data` alone (batched pending actions can share calldata).
- **V2 cap labels / idData** — governance `marketParams` + `fetch-markets-by-id.ts`
  enrichment for zero-allocation market and collateral caps.
- **Allocation freshness** — **Rebalance** refetches `vault-v2-risk` +
  `vault-v2-governance` before edit mode; tx preview still re-reads chain via
  `finalizeRebalancePlan`. Risk/governance BFF routes use `no-store` (no CDN cache).
- **Governance query key** — use `vaultV2GovernanceQueryKey(address)` from
  `useVaultV2Governance.ts` for all `refetchQueries` / invalidations (suffix
  `'caps-state-v2'`).
- **Client data freshness** — hooks use `apiFetch` (`cache: 'no-store'`);
  `CURATOR_REFETCH_INTERVAL_MS` and default `staleTime` are **30s** (capped via
  `API_CACHE_MAX_AGE_MS` in `lib/api/response-cache.ts`).
- **No server-side private keys** — all writes go through the connected wallet.
- **Multisig Safe** — Muscadine Allocator/Sentinel Safes (`lib/safe/config.ts`):
  queue from vault Allocation/Sentinel preview when governance lists the Safe as
  role holder; sign + execute on `/safe/[role]` with owner hot wallet.
  **localStorage is always kept** (export/import); optional Transaction Service
  sync via `NEXT_PUBLIC_SAFE_API_KEY` and `@safe-global/api-kit` ^5.x
  (`lib/safe/transaction-service.ts`, `service-sync.ts`, rate limit in
  `transaction-service-rate-limit.ts` — manual sync only, no polling). Safe Apps
  SDK embed via `CuratorSafeAppsProvider` (`lib/safe/safe-apps-context.tsx`);
  manifest at `public/manifest.json` (`muscadinelogo.svg`). Post-execute refetch
  via `refetch-vault-after-safe-execute.ts`; queue previews always shown (stored
  or decoded calldata in `decode-vault-calldata-preview.ts`). See `CLAUDE.md` §13.
- **Morpho GraphQL** — use `marketId` → app `marketKey` (not `uniqueKey`);
  `oracle.address` (not `Market.oracleAddress`); V2 overview txs use
  `vaultV2transactions`. Client logs `extensions.warnings` via
  `lib/morpho/graphql-client.ts`. See `CLAUDE.md` §4.4.1.
- **App routes (no `/curator` or `/overview` prefix)** — `/markets`,
  `/market/blue/[id]`, `/safe`, `/morpho`, `/monthly-statement`,
  `/muscadine-ledger`, `/muscadine-frontends`, `/vault/[address]`. Legacy page
  and API paths (`/curator/*`, `/overview/*`, `/vault/v2/*`, `/api/curator/markets`,
  `/api/vaults/v2/*`) **301 redirect** in `next.config.ts`.
- **BFF routes (no `/curator` or `/v2` in API paths)** — `GET /api/markets`,
  `GET /api/markets/[marketId]`; on-chain vault reads at
  `GET /api/vaults/[id]/risk`, `…/governance`, `…/pending` (alongside
  `…/history`, `…/holders`, etc.).
- **Vault pages** — `app/vault/[address]/page.tsx` is `'use client'` + React Query;
  keep **dynamic** (no SSG/`generateStaticParams` for vault addresses).
- **Curator Morpho Markets** — `/markets` (default: listed only, sort market size
  desc) and `/market/blue/[id]`; use `sizeUsd` / `totalLiquidityUsd` for size/
  liquidity columns (§4.7). `MarketOraclePanel` shows oracle price, spot gap,
  feed bounds, freshness, and block-explorer link. Allocation tab market names
  link in-app via `curatorBlueMarketHref`. Vault Risk tab uses the same helper.
  Sidebar Curator Tools icons: LineChart / Users / Wrench.
- **Oracle freshness** — `resolveMarketOracleAddress` accepts `oracleAddress` or
  `oracle.address`; risk BFF GraphQL keeps minimal oracle fragments (`baseFeedOne`
  on positions only) to stay under Morpho complexity limits; on-chain
  `BASE_FEED_*` reads are the fallback (`lib/morpho/oracle-utils.ts`).
- **Allocation display vs booked** — UI shows `max(GraphQL, on-chain)` per row;
  rebalance deltas use on-chain `bookedAllocationAssets` only
  (`overlay-v2-onchain-caps.ts`). Post-tx: refetch risk + governance, exit edit.
- **ESLint** — stay on **v9.39.x** with `eslint-config-next` flat config in
  `eslint.config.mjs`; do not bump to ESLint 10 until upstream plugins support it
  (§11).
- Keep `CLAUDE.md`, `AGENTS.md`, and `TODO.md` in sync with behavior changes.
