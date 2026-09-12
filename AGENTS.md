# AGENTS.md — Working Instructions for AI Assistants

**Brain hub (closed loop):** [`docs/brain/README.md`](docs/brain/README.md) — session protocol, changelog, Morpho MCP.  
This file is the **invariants contract**. Deep architecture: **`CLAUDE.md`**. Intent queue: **`TODO.md`**.

## Session checklist

1. **Read `TODO.md` first.** Work "Today" top-to-bottom unless directed otherwise. "Later" is out of scope unless asked.
2. **Follow the brain loop** (`docs/brain/README.md`): load context → use Morpho MCP for live Morpho data when needed → implement → close loop (TODO + `docs/brain/CHANGELOG.md` + docs).
3. **Read relevant `CLAUDE.md` sections** (especially §3 vault mental model and §5 reallocation UX) before changing allocation logic. Create-market: §18.
4. After substantive changes, run and pass:

```bash
npm run lint    # eslint . --max-warnings=0 (ESLint 9 + eslint-config-next — see CLAUDE.md §11)
npm run build   # next build
```

## Key invariants (do not regress)

- **Auth:** the only login username is `admin` (role `'admin'`); password from
  `CURATOR_ADMIN_PASSWORD` (legacy `CURATOR_OWNER_PASSWORD` accepted). BFF
  routes require the HttpOnly `curator_session` cookie (`proxy.ts` plus
  a route-level check). `apiFetch` sends `credentials: 'same-origin'`.
  `POST /api/auth/verify` is IP rate-limited (`AUTH_LOGIN_MAX_ATTEMPTS`).
  Sessions are HMAC-signed with `CURATOR_SESSION_SECRET` (required in
  production; development falls back to `CURATOR_ADMIN_PASSWORD`). Bump
  `CURATOR_SESSION_VERSION` to invalidate sessions. Login rate limits use
  Upstash REST when `UPSTASH_REDIS_REST_*` are set; otherwise they are
  per-instance memory.
- **V2-only vault config:** all tracked vaults are Morpho V2 (`lib/config/vaults.ts`).
  No MetaMorpho / V1 vault routes. Blue market risk uses `blue-market-data.ts` +
  `compute-blue-market-risk.ts`. MetaMorpho adapters are ignored in risk, allocation,
  and sentinel UIs. **Fee wrappers** (`kind: 'feeWrapper'`) use GraphQL
  `MorphoVaultV2Adapter.innerVault` (Morpho GraphQL) and empty allocate `data`
  (`EMPTY_ADAPTER_DATA`); they are listed on `/vaults` (Underlying then Wrapper,
  then Prime / Frontier / Test) but **not as peer vault pages**. Strategy vaults
  that have a wrapper get a **Fee wrapper** tab (`/vault/[address]/fee-wrapper`)
  with condensed TVL / users / history plus Morpho wrapper facts. Visiting a
  wrapper address redirects there. Sidebar lists underlyings only. Wrappers are
  excluded from protocol TVL (deposits sit in
  the underlying vault). Unique-user counts include wrappers but skip
  wrapper adapter contracts. Catalog lists
  wrappers and test vaults using Morpho/on-chain names. `underlyingAddress` is
  the GraphQL fallback for the child vault. Send-assets gate (underlying strategy
  vaults only): `lib/config/deposit-gates.ts` (`docs/brain/deposit-gates.md`).
  Gate calldata / propose: muscadine-onchain CLI. In this app, `/curator/gates`
  + `GET /api/gates/[address]` read the live gate and queue `setIsWhitelisted` /
  `setIsWhitelister` through Allocator / Curator Safes.
- **React Query polling** — dashboard hooks poll every 30s; indexed vault data
  (history, reallocations, holders, vault list) does not background-poll. The
  vaults sidebar is config-only (no Morpho fetch). On-chain vault
  hooks (`risk`, `governance`) use `staleTime: 0` + `refetchOnMount: 'always'`.
  See `lib/data/query-config.ts`.
- **V2 allocate/deallocate** is delta-based; idle is never in calldata;
  unallocated remainder defaults to implicit Idle, with an optional explicit
  dust recipient (cap-validated).
- **V2 cap `idData` ≠ deallocate `data`:** cap writes use prefixed ABI encoding
  (`"this"`, `"collateralToken"`, `"this/marketParams"`) via `lib/morpho/v2-id-data.ts`;
  allocate/deallocate adapter `data` is `encodeMarketParamsData(market)` for Morpho
  Blue markets only. Never pass bare addresses or raw MarketParams as cap `idData`.
- **V2 vault routes** (Morpho-style segments under `/vault/[address]/…`):
  Overview (`/vault/[address]`) → **Fee wrapper** (only when the vault has one) → `/allocation` → `/caps` → `/risk` → `/timelocks` →
  `/sentinel`. `/analytics` redirects to `/risk`. Overview: metrics (token + USD), collapsible holders → recent txs → history
  (10 per page with arrows, default closed), fees, roles, adapters.
  Fee wrapper tab: condensed boxes for wrapper TVL/APY/users/fees, overview, roles, gates, max rate, timelocks, plus collapsible holders/txs/history for the wrapper contract.
  Risk: market risk grades. Emergency actions on Sentinel (bottom).
  Pending actions embed in Caps; Sentinel is the only tab with sentinel writes (decrease caps,
  deallocate).
- **Allocation edit amounts** — Rebalance inputs show **display** (Allocated
  column / Morpho supply). Planning maps display → booked via
  `booked + (input − display)` so unchanged rows are no-ops and accrued interest
  is never treated as deployable cash. Min/Max write display-space values.
- **User deposit/withdraw and Blue/Midnight lend-borrow** — `muscadine-onchain` CLI (https://github.com/Muscadine-Labs/muscadine-onchain). This dashboard does not transact those.
- **Create Blue market / dead deposit** — same CLI (`blue create-market`).
  Browse Loan / Collateral / Search filter Blue **and** Midnight (`market-pair-filter.ts`).
  Top nav: Overview · Vaults · Markets · Curator · Business; sidebar is
  area-scoped (`lib/nav/areas.ts`). Curator area: Curator tools · Bots ·
  Send-assets gate · Multisig Safe. Overview Protocol KPIs open drill-downs (Users: holdings +
  combined txs; fee-wrapper adapters are labeled on holders/txs and omitted from unique-user counts). Bots (`/curator/bots`) watches allocator/sentinel/rebater activity
  (Allocator + Sentinel Safes on by default; other role holders off until toggled). Telegram:
  @MuscadineVaultBot. Bot repos: `Muscadine-Labs/muscadine-bots` is the
  **downstream** fork (`main`); `morpho-org/morpho-bots` is the upstream
  implementation (`MUSCADINE_BOTS_GITHUB_URL`, `MORPHO_BOTS_GITHUB_URL`).
- **Tx preview** — Allocation, Sentinel, and other vault role writes confirm
  through `TxPreviewDialog` + `lib/morpho/tx-preview.ts` before queueing to a Safe.
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
  role holder; **owners sign** on `/safe/[role]`; **any connected wallet can
  execute** once signatures ≥ threshold (Safe `execTransaction` is permissionless).
  **localStorage is always kept** (export/import); optional Transaction Service
  sync via `NEXT_PUBLIC_SAFE_API_KEY` and `@safe-global/api-kit` ^5.x
  (`lib/safe/transaction-service.ts`, `service-sync.ts`, rate limit in
  `transaction-service-rate-limit.ts` — manual sync only, no polling). Tabs:
  Home / Assets / Transactions / **History** (executed txs, on-demand) /
  **Settings** (modules, guard, address book). Queue several proposals into one
  MultiSend via `queueSafeBatch`. Safe Apps
  SDK embed via `CuratorSafeAppsProvider` (`lib/safe/safe-apps-context.tsx`);
  manifest at `public/manifest.json` (`muscadinelogo.svg`). Post-execute refetch
  via `refetch-vault-after-safe-execute.ts`; queue previews always shown (stored
  or decoded calldata in `decode-vault-calldata-preview.ts`). See `CLAUDE.md` §13.
- **Morpho GraphQL** — use `marketId` → app `marketKey` (not `uniqueKey`);
  `oracle.address` (not `Market.oracleAddress`); V2 overview txs use
  `vaultV2transactions`. Client logs `extensions.warnings` via
  `lib/morpho/graphql-client.ts`. See `CLAUDE.md` §4.4.1.
- **App routes** — `/` (Overview), `/vaults`, `/vault/[address]/*`,
  `/markets`, `/market/blue/[id]`, `/midnight/[id]`, `/safe`, `/safe/[role]/{assets,transactions,history,settings}`,
  `/curator` (Curator tools hub), `/curator/gates` (send-assets gate), `/curator/bots` (bot watch + repos),
  `/monthly-statement`, `/muscadine-ledger`, `/muscadine-frontends`.
  Deposit/lend/create-market writes live in muscadine-onchain. Vault pages live
  at `/vault/[address]/*`; catalog at `/vaults`. Markets browse at `/markets`.
- **BFF routes (no `/curator` or `/v2` in API paths)** — `GET /api/markets`,
  `GET /api/markets/[marketId]`; on-chain vault reads at
  `GET /api/vaults/[id]/risk`, `…/governance`, `…/pending` (alongside
  `…/history`, `…/holders`, etc.); protocol drill-downs at
  `GET /api/protocol-users`, `GET /api/protocol-transactions`; bot watch at
  `GET /api/bots/activity?panel=allocator|sentinel|rebater`; Midnight books at
  `GET /api/markets/midnight`, `GET /api/markets/midnight/[id]`; send-assets
  gate state at `GET /api/gates/[address]`; Safe extras at
  `GET /api/safe/[address]/history`, `GET /api/safe/[address]/settings`.
- **Vault pages** — `app/vault/[address]/{page,allocation,caps,…}` via
  `VaultPageShell` (`'use client'` + React Query); keep **dynamic** (no
  SSG/`generateStaticParams` for vault addresses).
- **Curator Morpho Markets** — `/markets` (default: All products, listed only, sort
  market size desc; product toggle All / Blue — variable rate / Midnight — fixed
  rate), `/market/blue/[id]` (Blue), and
  `/midnight/[id]` (Midnight order book — not Blue KPIs). Loan / Collateral /
  Search apply to both tables (`market-pair-filter.ts`). Midnight REST
  (`/v0/midnight/markets`, `/state`, `/books`); Morpho app is
  `https://markets.morpho.org/fixed/{chain}/{id}`. Use `sizeUsd` /
  `totalLiquidityUsd` for Blue sort columns; display token primary + USD
  secondary via `TokenUsdValue` (§4.7). Market writes live in muscadine-onchain;
  this app only browses (`curatorBlueMarketHref` / `curatorMidnightMarketHref`). `MarketOraclePanel` is used
  on Blue detail and Midnight collateral detail (Base RPC). Allocation
  tab market names link in-app via `curatorBlueMarketHref`. Vault Risk
  Analytics tab uses the same helper. Midnight rows use `curatorMidnightMarketHref`.
  Sidebar Curator area: Curator tools + Bots + Send-assets gate + Multisig Safe. Markets area: Browse.
  Vaults area: All vaults + vault tree.
- **Oracle freshness** — `resolveMarketOracleAddress` accepts `oracleAddress` or
  `oracle.address`; risk BFF GraphQL keeps minimal oracle fragments (`baseFeedOne`
  on positions only) to stay under Morpho complexity limits; on-chain
  `BASE_FEED_*` reads are the fallback (`lib/morpho/oracle-utils.ts`).
- **Allocation display vs booked** — UI shows `max(GraphQL, on-chain)` per row;
  rebalance **inputs** show that display amount; deltas use on-chain
  `bookedAllocationAssets` via `booked + (input − display)`
  (`overlay-v2-onchain-caps.ts`, `VaultV2Allocations.tsx`). **Planning total** =
  Σ booked + GraphQL idle (not `totalAssets`); Max leaves Idle at remaining
  deployable cash only (accrual residual is not Idle). Post-tx: refetch risk +
  governance, exit edit. Allocations **Min** = allocation minus withdrawable
  market liquidity (0 when fully liquid); replaces former Zero.
- **Curator networks** — Base, Ethereum, HyperEVM, Robinhood only
  (`CURATOR_MARKET_NETWORKS` + wagmi `chains`). Top-bar **NetworkSwitcher** sets
  preferred chain **without requiring a wallet**; when connected it also
  `switchChain`. `/markets` follows that preference
  (not AppKit-only chain UI).
- **Token display decimals** — `getTokenDisplayDecimals`: WETH/cbBTC → 6, USDC → 3
  (holders, txs, allocation history, markets token lines).
- **ESLint** — stay on **v9.39.x** with `eslint-config-next` flat config in
  `eslint.config.mjs`; do not bump to ESLint 10 until upstream plugins support it
  (§11).
- Keep `docs/brain/` (changelog + MCP), `CLAUDE.md`, `AGENTS.md`, and `TODO.md`
  in sync with behavior changes (closed loop).

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
