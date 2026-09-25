# CLAUDE.md — Curator App Architecture & Vault Mechanics

This document is the canonical reference for AI assistants (and humans) working in
this repository. It captures the structure of the app, how Morpho V1 and V2 vaults
work, the subtle on-chain rules that caused real reallocation bugs in the past, and
the conventions the code follows today. Keep it up to date whenever you change
vault mechanics, contract wiring, or the data flow.

---

## 0. Working Agreements (read first)

- **Review `TODO.md` at the start of every session.** It is the running task list
  for the repo. Work the "Today" section top-to-bottom unless the user
  directs otherwise; leave "Later" items alone unless asked.
- **Closed-loop brain:** [`docs/brain/README.md`](docs/brain/README.md) — session
  protocol, changelog, Morpho MCP. Append `docs/brain/CHANGELOG.md` when you
  finish substantive work. Cursor rule: `.cursor/rules/muscadine-brain.mdc`.
- **Before pushing:** run `npm run lint` and `npm run build` and make sure all pass.

### Environment variables

Copy `.env.example` → `.env.local`. See that file for the full list.

| Variable | Required? | Purpose |
|----------|-----------|---------|
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | **Yes in production** | WalletConnect / Reown |
| `ALCHEMY_API_KEY` or `COINBASE_CDP_API_KEY` | Recommended | Server Base RPC |
| `NEXT_PUBLIC_ALCHEMY_API_KEY` | Recommended | Client Base RPC |
| `NEXT_PUBLIC_APP_URL` | No | App origin (wallet metadata) |
| `NEXT_PUBLIC_SAFE_API_KEY` | No | Safe Transaction Service |
| `CURATOR_ADMIN_PASSWORD` | Login | Admin auth and session HMAC (unless `CURATOR_SESSION_SECRET` is set) |
| `CURATOR_SESSION_SECRET` | No | Optional dedicated HMAC for `curator_session` |
| `CURATOR_SESSION_VERSION` | No | Bump to invalidate all sessions |
| `CURATOR_TRUSTED_PROXY_HOPS` | **Yes in production** | Proxy count in front of the app; required for per-IP login rate limiting |
| `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` | Recommended in production | Shared login rate-limit store across serverless isolates |
| `MORPHO_API_URL`, `NEXT_PUBLIC_VAULT_*` | No | Overrides |
| `SEND_ASSETS_GATE_DEPLOY_BLOCK` | No | First block of a redeployed send-assets gate (roster event scan start); default gate is built in |

---

## 1. Project Overview

**Curator** is a Next.js (App Router) + TypeScript + Tailwind dashboard used by
Muscadine for managing and reporting on Morpho-style vaults on Base (chainId
`8453`). It covers:

- Vault overview, TVL, revenue and fee charts
- Per-vault pages for **Morpho V2** vaults (risk, governance, caps, allocation,
  sentinel) plus **Curator Morpho Markets** browser/detail
- Monthly statements (via DefiLlama and Morpho GraphQL)
- Curator tools (EIP-7702 delegation, Safe, frontend, morpho)
- Google Sheets integration for reporting

### Tech stack

- **Framework**: Next.js App Router (`app/`)
- **Language**: TypeScript (strict)
- **Styling**: Tailwind CSS + shadcn-style components in `components/ui/*`
- **Data**: React Query (`@tanstack/react-query`) for client caches
- **Wallet UI**: `@reown/appkit` + `@reown/appkit-adapter-wagmi` + `wagmi`
  (`WagmiAdapter` in `lib/wallet/config.ts`, `createAppKit` in
  `lib/wallet/appkit.ts`, custom connect button in topbar). Featured wallets
  (in order): **Rabby, MetaMask, Base, Phantom** — plus WalletConnect and
  injected EIP-6963. No server-side private keys for vault writes.
- **GraphQL**: Morpho Blue API (`https://api.morpho.org/graphql`) via
  `graphql-request` in `lib/morpho/graphql-client.ts`. **Vault list, detail,
  history, risk, and protocol stats BFF routes use this client directly** — not
  the Morpho SDK runtime.
- **Onchain writes (allocator / sentinel / Safe UI)**: ABIs in
  `lib/onchain/abis.ts` + `vault-writes.ts`. Blue create-market, vault
  deposit/withdraw, gates, and Vineyard deploy live in
  [muscadine-onchain](https://github.com/Muscadine-Labs/muscadine-onchain).
- **Auth**: Custom curator auth (`lib/auth/*`) with signed session tokens

---

## 2. Repository Layout

```
app/
  api/                 Next.js route handlers (BFF for Morpho + onchain data)
    vaults/            GET /api/vaults, /api/vaults/[id], history, holders, …
    vaults/[id]/       On-chain vault endpoints (risk, governance, pending)
    markets/           Morpho Blue markets browser + detail BFF
    protocol-stats/    Aggregate TVL / revenue
    monthly-statement-* Statement generators
    google-sheets/     Sheets export
    auth/              Session verify
    safe/[address]/    GET /api/safe/[address]/info (owners, threshold, nonce, ETH)
  markets/             Morpho Markets browser (`/markets`)
  market/blue/[id]/    Blue market detail
  safe/                Multisig Safe workspace
  curator/             Curator tools hub (`/curator`)
  curator/bots/        Bot activity watch (`/curator/bots`)
  monthly-statement/   Treasury / DefiLlama statements
  muscadine-ledger/    Internal ledger
  muscadine-frontends/ Frontend links
  vault/[address]/     Vault detail page (Morpho V2)

components/
  morpho/              VaultV2Allocations, VaultV2Caps, VaultV2Sentinel,
                       TxPreviewDialog, AllocationListView, …
  safe/                SafeOverviewPanel, SafeTransactionQueue, workspace link
  layout/              AppShell, Sidebar, Topbar
  ui/                  Primitive components (button, card, input, table, ...)

lib/
  auth/                Curator auth context + server helpers
  config/vaults.ts     Tracked vault addresses (V1 + V2)
  data/                api-fetch, query-config (30s refetch)
  api/                 response-cache helpers for BFF routes
  format/number.ts     Central number/BigInt formatting helpers
  hooks/               React Query hooks for vault data
  morpho/              GraphQL queries, tx-preview, cap-decrease-input, …
  safe/                Muscadine role Safe config, Protocol Kit client,
                       localStorage pending queue, vault calldata builders
  onchain/
    abis.ts            Vault V2 ABI only
    vault-writes.ts    V2 write config builders
    client.ts          viem client factory
    contracts.ts       Chain/address constants
    vault-writes.ts    Typed write config builders (reallocate, allocate,
                       deallocate, caps, multicall, ...)
  theme/               Theme context
  utils/               Logger, rate limit, env validation, error handler
  wallet/              Wagmi + Reown AppKit (`WagmiAdapter`, `createAppKit`), indexeddb polyfill

.env / .env.local      Public env vars: NEXT_PUBLIC_VAULT_* addresses, RPC URL,
                       Morpho API URL, auth secrets
```

---

## 3. Vault Mental Model

A **Morpho vault** is an ERC-4626 wrapper that supplies user deposits into one or
more Morpho Blue markets. Each market is identified by a 32-byte `Id =
keccak256(marketParams)`. In Morpho GraphQL (2026+), the same 32-byte id is
exposed as `market.marketId` (legacy field name was `uniqueKey`). App code still
uses the JSON key `marketKey` in API responses; resolve GraphQL with
`marketKeyFromGraphQL()` in `lib/morpho/morpho-app-links.ts`.

Allocators (curator/allocator role) periodically rebalance idle + market
balances. V1 and V2 reach the same goal via _different_ contract semantics.
Getting those semantics wrong is the #1 source of reverts.

### 3.1 Morpho V1 (MetaMorpho) — **protocol reference only**

> **Curator does not use V1 vaults.** All configured vaults are Morpho V2
> (`lib/config/vaults.ts`). There is no V1 detail route, no MetaMorpho adapter
> UI, and no `vaultByAddress` queries. The rules below are kept only for
> understanding Morpho Blue / MetaMorpho protocol semantics elsewhere.

- Contract: `MetaMorpho` (Morpho Blue ERC-4626 vault)
- Write entrypoint: `reallocate(MarketAllocation[] allocations)`
  - `MarketAllocation { MarketParams marketParams; uint256 assets; }`
  - `assets` is the **target supply** the vault should hold in that market
    after the call (NOT a delta)
- Semantics (critical):
  1. Contract iterates the array **in order**. For each entry, if the target is
     lower than the current on-chain supply, it **withdraws** the difference; if
     higher, it **supplies** the difference. This means withdrawals must come
     _before_ deposits in the array.
  2. `sum(withdrawn) == sum(supplied)` must hold exactly, or the transaction
     reverts with **`InconsistentReallocation`**.
  3. Between building the tx client-side and executing it on-chain, interest
     accrues. The on-chain "current" value drifts upward. If we fix every target
     numerically, `sum(withdrawn)` ends up slightly larger than
     `sum(supplied)` and the call reverts.
  4. The vault idle balance is also included in the reconciliation. If the
     totals don't match, excess idle must be absorbed by a deposit.
- **Mitigation (the "max catcher")**:
  - Set the last deposit's `assets` to `type(uint256).max` (`maxUint256`). The
    contract interprets this as "supply whatever is still idle," which exactly
    absorbs the dust from accrual and guarantees the invariant.
  - When implementing V1 reallocate UIs elsewhere, withdrawals must precede
    deposits and the largest deposit should be the catcher.
- **Cap model**: each market has a `supplyCap` (absolute assets). We validate
  targets against `supplyCap` client-side before sending the tx.

### 3.2 Morpho V2 — **delta-based `allocate` / `deallocate`**

- Contract: Vault V2 (`lib/onchain/abis.ts: vaultV2Abi`)
- Write entrypoints (per adapter):
  - `allocate(address adapter, bytes data, uint256 assets)`
  - `deallocate(address adapter, bytes data, uint256 assets)`
  - `multicall(bytes[] calls)` for batching
- Semantics:
  1. `assets` is the **delta** to move (not a target). Calls are independent.
  2. Allocation identities are keyed by `id = keccak256(idData)`. The adapter
     decodes `idData` into a Morpho market or child vault.
  3. V2 enforces two caps per id:
     - `absoluteCap` — raw token cap (same units as the underlying asset)
     - `relativeCap` — fraction of `firstTotalAssets` scaled by `WAD = 1e18`
       (`1e18 == 100%`). `firstTotalAssets` is the vault assets snapshot at the
       start of the tx (approximated client-side with the current total assets).
  4. Violating a cap reverts. We validate both caps before sending.
- **Cap data source**: `useVaultV2Governance` (`/api/vaults/[id]/governance`),
  which returns `CapInfo[]` keyed by `id = keccak256(idData)`.
- **Cap `idData` vs adapter `data` (critical — do not conflate)**:
  All encoding helpers live in `lib/morpho/v2-id-data.ts`. The vault hashes
  `idData` to get the cap/allocation id; adapter calldata uses different bytes.

  | Purpose | Function | Encoding |
  | ------- | -------- | -------- |
  | Adapter cap id | `encodeAdapterCapIdData` | `abi.encode("this", adapterAddress)` |
  | Collateral cap id | `encodeCollateralCapIdData` | `abi.encode("collateralToken", collateralAddress)` |
  | Market cap id | `encodeMarketCapIdData` | `abi.encode("this/marketParams", adapterAddress, marketParams)` |
  | Blue market allocate/deallocate `data` | `encodeMarketParamsData` | `abi.encode(marketParams)` — five-tuple, no prefix |
  | MorphoVaultV2Adapter allocate/deallocate `data` | `EMPTY_ADAPTER_DATA` | empty bytes (`0x`) |

  Use `resolveCapIdData(cap, risk)` for `decreaseAbsoluteCap` /
  `decreaseRelativeCap`. Market caps need `cap.adapterAddress` from governance
  GraphQL plus full market params from the risk API (oracle, irm, lltv, token
  addresses). Wrong encoding causes silent cap lookup misses or on-chain reverts.
  `resolveCapIdData` only encodes market params that hash back to
  `cap.marketKey` (`marketParamsMatchMarketKey`: Blue id =
  `keccak256(abi.encode(marketParams))`) and always uses the cap's own
  adapter; otherwise it returns `null`. Partial params back-filled with zero
  addresses give the id of a market that does not exist, and
  `decreaseAbsoluteCap(wrongId, 0)` **succeeds on-chain while changing nothing**
  — a silent no-op on the emergency path. Do not bypass the check.
  Reference: [Morpho market listing docs](https://docs.morpho.org/curate/tutorials-v2/market-listing/).
- **No max-catcher needed** — V2 is delta-based so interest drift doesn't cause
  a balancing revert; the allocator simply chooses deltas.
- **Display vs booked allocation** — risk overlay (`overlay-v2-onchain-caps.ts`)
  sets `allocationAssets` / UI `displayAssets` to the adapter's **live position**
  — Blue adapter `expectedSupplyAssets(marketId)`, fee-wrapper Vault V2 adapter
  `realAssets()` — so accrued interest shows between rebalances. Only when that
  read fails does it fall back to `max(Morpho position supply, allocation(id))`.
  Do **not** go back to the max as the primary source: right after a
  deallocation Morpho's indexer still reports the old supply, the row keeps
  showing it, and `booked + (input − display)` then moves far more than the
  curator typed. Write planning uses on-chain `bookedAllocationAssets` /
  `currentAssets` only. Always
  emit `bookedAllocationAssets` as a string (including `"0"`). **Rebalance
  inputs** show display amounts (same as Allocated column); resolve via
  `booked + (input − display)` so unchanged rows are no-ops. Min/Max write
  display-space values. Post-wallet rebalance: await risk + governance refetch,
  exit edit mode, reset write hook.
- **Idle (vault cash)** — V2 holds unallocated assets in the vault contract.
  **Deployable idle** is the vault's own `asset().balanceOf(vault)`, read on-chain
  in `overlay-v2-onchain-caps.ts` (same read the submit-time refresh uses);
  Morpho GraphQL `idleAssets` is only the fallback when that read fails. It is
  **never** `totalAssets − Σ allocation(id)`: that residual includes **interest
  accrual** in `totalAssets()` that is not withdrawable cash — treating it as
  idle caused phantom ~8 USDC buffers and `TransferReverted` on allocate.
  Planning totals use Σ row currents + idle; relative cap checks use on-chain
  `totalAssets` (`chainTotalRaw`). This is
  **not** a strategy adapter contract, but the UI treats idle as a first-class
  rebalance target alongside **Morpho Blue market** (`MorphoMarketV1Adapter`) rows
  and, on fee wrappers, a single **Morpho Vault V2** (`MorphoVaultV2Adapter`) row:
  - **Adapters tab** (`VaultV2Adapters.tsx`): always show an **Idle Adapter**
    row (even at $0).
  - **Allocations tab** (`VaultV2Allocations.tsx`): idle is an editable target
    row included in totals and `%` columns; cap validation is skipped.
  - **Rebalance submit**: never call `allocate`/`deallocate` with idle `idData`.
    Raising the idle target emits **deallocate** calls on lowered adapter targets;
    lowering idle emits **allocate** calls elsewhere. **Do not** auto-push
    under-allocation remainder onto the largest strategy target — that inflated
    a single market by tens of thousands of units. V2 planning uses `inputSum`
    (sum of entered targets) for the banner; unallocated remainder is implicit
    **Idle** via deallocations. With `auto`, `applyPlanningDust` writes that
    remainder onto the **Idle** planning row only (Idle never reaches
    calldata). At submit, `refreshPlanRowsFromChain` re-anchors Idle with
    `shiftTargetToLiveCurrent` (live cash ± the planned delta) — keeping the
    absolute value would carry a stale GraphQL idle into the plan total and trip
    "exceeds on-chain vault total". The curator can **explicitly** route the
    remainder to a strategy target via `DustRecipientSelect` (default `auto` =
    Idle); the explicit recipient still goes through cap validation before submit.
  - **% input mode**: switching writes each row as a 2-dp percent rounded down.
    A row whose string still equals `rawToPercentInput(current, total)` resolves
    to its **booked** amount (`resolveTargetAssetsFromInput`); otherwise every
    untouched row became a small phantom deallocation.
  - **Delisted targets**: a strategy row with **zero allocation and no active
    cap** (absolute and relative both absent/zero, with governance caps loaded)
    is hidden from the Allocations list — the vault can no longer allocate to
    it (e.g. a deallocated + delisted Blue market that Morpho's own UI no
    longer shows). Zero-allocation rows with a live cap stay visible. Same rule
    on V1: zero allocation + supply cap exactly 0 is hidden (`null` cap =
    unknown, kept; `parseSupplyCap` preserves explicit `0`).
  - **Risk tab** (`VaultRiskV2.tsx`): idle counts toward **Adapters Count**
    (`strategy adapters + 1`) and appears as its own row (“No strategy risk”).

#### 3.2.1 Fee wrappers (Vault V2 → underlying Vault V2)

A **fee wrapper** is a Vault V2 that allocates only to one underlying Vault V2 via
`MorphoVaultV2Adapter` (GraphQL `__typename`; `type` is `MorphoVaultV2`).
Morpho GraphQL names the child `innerVault { address name symbol avgNetApy liquidity }`;
curator maps that to **underlying vault** (`underlying` / `underlyingAddress`).
Allocate/deallocate `data` is **empty** (`0x` / `EMPTY_ADAPTER_DATA`) — not
market params. Cap `idData` is still `abi.encode("this", adapterAddress)`.
`addAdapter` / `removeAdapter` and critical gates are typically abdicated.
Wrappers are **not listed** on app.morpho.org (`listed: false`). Keep the
**Open on Morpho** overview link anyway. Morpho docs:
[Fee Wrapper](https://docs.morpho.org/developers/earn/concepts/fee-wrapper/).

Config: `kind: 'feeWrapper'` + `underlyingAddress` in `lib/config/vaults.ts`.
`underlyingAddress` uses the **same env default** as the child strategy vault
(`NEXT_PUBLIC_VAULT_USDC_V2`, etc.) and is the GraphQL fallback when
`innerVault` is omitted. Display names are Morpho/on-chain names (`USDC Prime`)
with a ` (wrapper)` suffix on fee wrappers (`withFeeWrapperLabel`). Catalog also
keeps a **Wrapper** badge. GraphQL fragments must include `... on MorphoVaultV2Adapter` on
list, governance, and risk queries — omitting them makes the adapter invisible
(same failure mode as skipping `marketId`). Do **not** treat wrappers as
Blue-market strategy vaults. Do **not** sum wrapper TVL into protocol stats —
deposits sit inside the underlying vault. Unique-user / active-vault KPIs **do**
include wrappers. Treasury statements **do** include wrappers (their
performance/management fees). Transact lists wrappers and test vaults with
their real names.

Allocation sections on wrappers: **Idle → Morpho Vault V2**. Writes use empty
adapter data. Risk grades live on the underlying vault page, not the wrapper.
Wrapper **viewing** lives on the underlying vault's **Fee wrapper** tab
(`/vault/[underlying]/fee-wrapper`): condensed TVL / users / history plus
sub-tabs **Overview** (Morpho-style overview, fees, roles, gates, max rate) /
**Allocation** (`VaultV2Allocations` with `liquidityAdapterVariant="vault-or-idle"`
— it renders the single liquidity adapter panel and its own error state; do not
add a second `VaultV2LiquidityAdapter` beside it) / **Caps / timelocks**
(`VaultV2Caps` with `preloadedPending` from `useVaultV2Pending`, tab label shows
the pending count). Visiting a
fee-wrapper address redirects to that tab. The vaults sidebar lists underlyings
only; `/vaults` still groups Wrapper rows and links them to the tab.

Keep **skipping** `MetaMorphoAdapter` (V1 MetaMorpho child). That is not a fee
wrapper.

### 3.3 Summary of V1 vs V2

| Aspect              | V1 (MetaMorpho)                                | V2                                                    |
| ------------------- | ---------------------------------------------- | ----------------------------------------------------- |
| Write fn            | `reallocate(MarketAllocation[])`               | `allocate` / `deallocate` / `multicall`               |
| Amount semantics    | Absolute target per market                     | Delta per adapter/id                                  |
| Ordering            | Withdrawals first, then deposits               | Independent calls                                     |
| Balancing invariant | `sum(with) == sum(sup)` (incl. idle)           | None (per-call)                                       |
| Dust handling       | Last deposit = `type(uint256).max`             | N/A                                                   |
| Caps                | `supplyCap` per market                         | `absoluteCap` + `relativeCap` (WAD) per id            |
| Common revert       | `InconsistentReallocation` from accrued dust   | Cap exceeded / adapter-level checks                   |

---

## 4. Data Flow for Allocation Pages

### 4.1 Vault list (V2 only)

`GET /api/vaults` and `GET /api/vaults/[id]` query **Morpho V2** vaults from
`lib/config/vaults.ts` only. There is no V1 vault list batch and no
`app/vault/v1/…` detail route.

### 4.2 V2 (`app/vault/[address]/page.tsx`)

**Rendering** — the vault page is `'use client'` and loads all tab data via React
Query (`useVaultV2Complete` → BFF + on-chain hooks). Keep the `[address]` segment
**dynamic**; do not add `generateStaticParams` or SSG — TVL, allocations, caps,
and risk change continuously and hooks refetch on tab switch and post-tx.

**Tab order**: Overview → Fee wrapper (when configured) → Allocation → Caps → Risk → Timelocks → Sentinel.
Overview holds metrics, collapsible holders → recent txs → history (10 per page
with arrows, default closed), fees, roles, and adapters; the Fee wrapper tab
holds condensed wrapper TVL / users / history and Morpho wrapper facts; Risk holds market risk
grades; Sentinel holds emergency actions at the bottom.

1. `useVaultV2Complete` fans out to:
   - `useVault(address)` for base data
   - `useVaultV2Risk` → `/api/vaults/[id]/risk` (adapters, markets, idle)
   - `useVaultV2Governance` → `/api/vaults/[id]/governance` (caps, roles,
     timelocks, `idleAssets`)
   - `useVaultV2Pending`
2. **Roles** — `VaultV2Roles.tsx` (read-only): owner, curator, allocators,
   sentinels.
3. **Adapters** — `VaultV2Adapters.tsx` lists the idle adapter first, then
   **Morpho Blue market** strategy adapters from governance (MetaMorpho adapters
   are hidden). Pass `assetSymbol` / `assetDecimals` from the vault page.
4. **Caps** — `VaultV2Caps.tsx`. Morpho-style tables grouped **markets →
   collateral → adapters** (Name, Allocation, Absolute cap, Relative cap with
   utilization rings). Embeds `VaultV2Pending` when `pending.length > 0`.
   Tab label shows pending count. Pass `assetSymbol` / `assetDecimals` /
   `totalAssetsUnderlying` from the vault page. Compact amounts
   (`83.36k USDC`); infinite uint128/uint256 caps show **Infinite**. When the
   Vault V2 Blue Public Allocator is an allocator, a **Vault | Public Allocator**
   toggle shows idle-pull, penalty, per-market target ceiling, and allow
   deallocation ([docs](https://docs.morpho.org/learn/concepts/public-allocator/)).
5. **Timelocks** — `VaultV2Timelocks.tsx` (read-only).
6. **Allocation** — `VaultV2Allocations.tsx` receives `preloadedData`
   (governance) **and** `preloadedRisk`. Its **Liquidity adapter** panel marks
   the current option from governance `liquidityAdapter` / `liquidityData`,
   which the governance route overlays with on-chain `liquidityAdapter()` /
   `liquidityData()` (the indexer lags `setLiquidityAdapterAndData`, so a
   post-write refetch would otherwise still show the old adapter as current). Caps are resolved via
   `keccak256(idData)` using helpers in `lib/morpho/v2-id-data.ts` (see §3.2).
   **List layout** — sections **Idle → Morpho Vault V2 → Morpho Blue Market**.
   Row types:
   - **MorphoMarketV1Adapter** — one row per Morpho Blue market position. LLTV pill
     next to name. Utilization, borrow/supply APY, liquidity from `market.state`.
     APY/utilization GraphQL values are **decimals**; multiply by 100 before
     `formatPercentage`.
   - **MorphoVaultV2Adapter** — fee wrapper underlying vault (empty allocate `data`).
     Name links to `/vault/{underlying}`. Rate column is underlying `avgNetApy`.
   - **Idle** — vault cash row; no on-chain cap; no direct writes.
7. **Risk** — `VaultAnalyticsPanel` on the **Risk** tab (`/vault/[address]/risk`;
   `/analytics` redirects here): market risk grades (`VaultRiskV2`) only.
8. **Sentinel** — `VaultV2Sentinel.tsx` (Morpho Curator–style; **only tab with
   sentinel writes**). **Emergency Actions** link at the bottom. Sections:
   - **Allocation Overview** — stacked bar + per-target token amounts and `%`.
   - **Vault Pending Actions** — embedded `VaultV2Pending` with **Revoke** per row
     (`allowRevoke`). Each item has a stable `rowId` (list index) so per-row tx
     state does not bleed when multiple pending actions share the same `data`
     bytes (e.g. batched cap increases). Only the active row shows loading/error.
     Status (Executable vs Pending) is re-derived on the client from `validAt`
     and a ticking clock; a missing `validAt` (0) is never Executable.
     Accept/revoke previews use the `accept` / `revoke` actions, not `allocate`.
   - **Decrease Caps** — adapter / collateral / market tables; radio pick
     absolute vs relative per row; new value input; **Clear** resets the row form
     only; **Decrease** submits a single-row `decreaseAbsoluteCap` /
     `decreaseRelativeCap`. Per-row `activeRowKey` — only one write in flight.
     Market/collateral labels and cap `idData` resolve from governance
     `marketParams` + Morpho market index (`lib/morpho/fetch-markets-by-id.ts`)
     even when allocation is zero. Uses `resolveCapIdData` + `parseHumanTokenInput`.
     New cap must be **≤ current** cap. `TransactionButton` uses
     `suppressConnectPrompt` (wallet connect is in the topbar only).
   - **Deallocate to Idle** — table (Idle row display-only) with amount + Min
     per Blue market row; **per-row Deallocate** via `encodeMarketParamsData`.
     **Min** fills withdrawable liquidity (`minTargetFromLiquidity` — same rule
     as Allocations Min: leaves illiquid remainder). Uses booked on-chain
     allocation (not display). Token parse via `parseHumanTokenInput`.
9. **Emergency actions** — bottom of **Sentinel** tab (not Overview). Links to
   Morpho Curator emergency actions:
   `https://curator.morpho.org/vaults/{chainId}/{vaultAddress}/emergency-actions`
10. Submits use `v2WriteConfigs.allocate/deallocate` wrapped in
   `v2WriteConfigs.multicall` when multiple moves are planned.

Per-market risk scoring lives in `lib/morpho/compute-blue-market-risk.ts` and is
surfaced on the vault **Risk** tab and Curator market detail pages.

### 4.3 Caching

**TTL ceiling (30s):** BFF CDN cache, in-process server cache, React Query
`staleTime`/poll intervals, and `fetch-markets-by-id` lookup reuse are all
capped at **30 seconds** via `API_CACHE_MAX_AGE_SECONDS` / `API_CACHE_MAX_AGE_MS`
in `lib/api/response-cache.ts` (`clampCacheMaxAgeSeconds`, `clampCacheTtlMs`).

**BFF HTTP cache** — authenticated routes use `mergeApiCacheHeaders()` →
`private, no-store` (session cookie; do not CDN-cache). In-process
`withServerResponseCache` still dedupes Morpho for 30s.

**On-chain vault routes** — `GET /api/vaults/[id]/risk` and
`.../governance` use `mergeApiOnChainVaultHeaders()` → `private, no-store`
(no CDN cache; each request runs GraphQL + RPC overlay).

**In-process dedupe** — `withServerResponseCache()` (`lib/api/server-response-cache.ts`)
for expensive handlers (e.g. `protocol-stats`, vault list, treasury statement);
TTL clamped to 30s; expired keys pruned; loader timeout 40s.

**Client React Query** (`lib/data/query-config.ts`):

| Tier | Hooks | Poll | staleTime | Refetch triggers |
| ---- | ----- | ---- | --------- | ---------------- |
| Dashboard | protocol stats | 30s | 30s | mount, poll |
| Indexed vault | history, reallocations, holders, tx, vault list | none | 30s | mount, tab |
| On-chain vault | `useVaultV2Risk`, `useVaultV2Governance` | none | 0 | mount (always), vault tab switch (allocations/caps/sentinel/adapters), post-tx, **Rebalance** click |

Hooks use `apiFetch` (`cache: 'no-store'`) to bypass the browser HTTP cache.

Query keys:

- `['vault', address]`
- `['vault-history', address]`
- `['vault-v2-risk', address]`
- `['vault-v2-governance', address, 'caps-state-v2']` — use
  `vaultV2GovernanceQueryKey(address)` from `lib/hooks/useVaultV2Governance.ts`
  for refetches/invalidations
- `['vault-v2-pending', address, 'row-id']`
- `['vault-reallocations', address]`
- `['markets']`, `['protocol-stats']`

Hooks live in `lib/hooks/` and should be the only entry points for reading
vault data from components.

### 4.3.1 Vault list API and sidebar

`GET /api/vaults` (`app/api/vaults/route.ts`) fans out V1 (`vaults { … }`) and
per-address V2 (`vaultV2ByAddress`) Morpho GraphQL queries. Each row is enriched
from `lib/config/vaults.ts` with:

- `id` — same as vault `address` (for legacy UI keys)
- `version` — `v1` | `v2` from config `morphoVersion`
- `listCategory` — optional `prime` | `vineyard` | `frontier` | `test`
- `kind` — optional `strategy` (default) | `feeWrapper`
- `underlyingAddress` — child Vault V2 when `kind` is `feeWrapper` (same env
  default as the strategy vault; GraphQL `innerVault` fallback)

`?includeAll=true` includes test vaults (`excludeFromBusinessViews`); default list
is business vaults only (including fee wrappers).

Protocol TVL (`getVaultAddressesForProtocolStats`) excludes fee wrappers so
deposits are not double-counted. Unique users and the active-vault KPI
(`getActiveVaultAddressesForStats`) include wrappers; wrapper adapter
contracts are omitted from the user set.

**Top nav + Sidebar** — Topbar areas: Overview · Vaults · Markets · Curator ·
Business (`lib/nav/areas.ts`). Sidebar is **area-scoped**. Under **Vaults**: All
vaults (`/vaults`), then network vault trees (Underlying → Wrapper, then Prime →
Frontier → Vineyard → Test). The `/vaults` catalog (`VaultsCatalog`) uses
`groupVaultsByKindAndCategory`. Legacy page/API paths still **redirect** via
`next.config.ts` (`/vaults/transact` → `/vaults`). Catalog is `/vaults`; vault
ops are `/vault/[address]/*`. User deposit/withdraw is muscadine-onchain.

Ethereum appears in `SIDEBAR_NETWORKS` but has no configured vaults — expand
**Base**, not Ethereum, to see vault links.

### 4.4 Vault overview, liquidity, and history (Morpho GraphQL)

**Overview** — `VaultOverviewPanel` + `GET /api/vaults/[id]` (`app/api/vaults/[id]/route.ts`).

- **Metrics card** — token amount **primary**, USD **secondary** via
  `TokenUsdValue` (`components/morpho/TokenUsdValue.tsx`): Total Assets, Liquidity,
  Idle. Deployed % when available. History chart on Overview (not Risk).
- **TVL** — V1: `vault.state.totalAssetsUsd`; V2: `vaultV2.totalAssetsUsd`.
- **Liquidity (withdrawable)** — Morpho-computed amount users can actually redeem.
  - V1: `vault.liquidity { usd, underlying }` (vault root, not `state`).
  - V2: `vaultV2.liquidityUsd` / `liquidity` (raw underlying units).
  - **Not** `TVL − idle`, and **not** `VaultV2History.realAssetsUsd` (that series is
    deployed assets ≈ TVL − idle, which diverges from `liquidityUsd` when idle or
    adapter liquidity constraints differ).
- **Idle** — V2 only: `idleAssets` / `idleAssetsUsd` (cash in the vault contract).
- Analytics object from `lib/morpho/vault-analytics.ts` (`buildVaultAnalytics`).

**History chart** — `VaultOverviewHistoryChart` + `GET /api/vaults/[id]/history`
(`lib/morpho/vault-history.ts`, `useVaultHistory`).

| Metric | V1 `VaultHistory` | V2 `VaultV2History` |
| ------ | ----------------- | ------------------- |
| TVL (tokens supplied) | `totalAssets` / `totalAssetsUsd` | same |
| APY | `netApy` (×100 for %) | `avgNetApy` (×100 for %) |
| Price per share (token) | `sharePriceNumber` (human decimal per share) | `sharePrice` |
| Price per share (USD) | `sharePriceUsd` | `totalAssetsUsd ÷ totalSupply` (18-decimal shares) |
| Liquidity | **not indexed** | **not indexed** |

- Response flag `liquidityHistoricalAvailable` is always `false`. Do **not** synthesize
  liquidity from TVL, idle, or `realAssetsUsd`.
- The history chart **does not offer a Liquidity metric** (removed — no indexed
  timeseries). Spot withdrawable liquidity stays on the **Overview** metrics card.
- History metrics (`MetricModeFilter`): **TVL** (label for tokens supplied),
  **Price per share**, **APY**.
- **Price per share** uses `UsdTokenModeFilter`: **Tokens** = underlying per share;
  **USD** = dollar per share. Y-axis tick precision is **adaptive**
  (`axisFractionDigits` in `VaultOverviewHistoryChart.tsx`): fraction digits are
  derived from the zoomed domain span so near-flat series (e.g. cbBTC share
  price ≈ 1.0000x, or USD share price ≈ $104k with small drift) get distinct
  tick labels instead of repeating compact values.
- `useVaultHistory` normalizes responses via `normalizeVaultHistoryResponse()` so
  stale React Query cache missing new series keys does not crash the chart.
  Query key includes a version suffix when series shape changes.
- Filters: `MetricModeFilter`, `UsdTokenModeFilter` (USD / Tokens on supplied and
  share price), `TimeRangeFilter`.
- Pure helpers: `lib/morpho/vault-history.ts` (`mapMorphoTimeseries`,
  `computeSharePriceUsdSeries`, `VAULT_SHARE_DECIMALS = 18`).

### 4.4.1 Morpho GraphQL schema drift (do not regress)

Morpho’s public GraphQL schema changed; invalid fields fail the **whole** query.
Symptoms: empty `GET /api/vaults`, “Unknown V2 Vault” detail fallbacks, 500s on
V1 detail.

| Legacy field | Current field | Where |
| ------------ | ------------- | ----- |
| `whitelisted` on `Vault` / `VaultV2` | `listed` | List + detail queries; map to UI `status` (`listed` → active) |
| `uniqueKey` on `Market` | `marketId` | All market GraphQL selections; app JSON uses `marketKey` (not `uniqueKey`) |
| `Market.oracleAddress` | `oracle.address` | Risk, governance, curator-markets, fetch-markets-by-id, `blue-market-data.ts` |
| `Query.transactions` | `vaultV2transactions` | Vault overview snippet in `app/api/vaults/[id]/route.ts` |
| `VaultState.avgApy`, `monthlyNetApy`, `weeklyNetApy`, `dailyApy`, `netApyWithoutRewards`, … | Removed — use `apy`, `netApy`, `avgNetApy`, `netApyExcludingRewards` | V1 detail + list |
| V2 spot `avgApy` on vault | Use `apy`, `avgNetApy`, `maxApy` | V2 detail + list |

**GraphQL client** — `lib/morpho/graphql-client.ts` uses `rawRequest` and logs
`extensions.warnings` (Morpho deprecation notices) via `lib/utils/logger.ts`.
Monitor server logs when Morpho schedules field removals.

**Client-side Morpho queries** (browser `morphoGraphQLClient` in `useVaultCaps`,
`useVaultQueues`) must use `marketId` as well — not only server routes.

V1 list query must not use removed `VaultState` APY fields (`weeklyNetApy` /
`monthlyNetApy` caused silent empty V1 rows via `.catch(() => [])`).

**Other Morpho API fixes (do not regress):**

- V1 detail query: `warnings` on **vault root**, not `state` (GraphQL validation error).
- V2 governance caps: GraphQL `type` is `Adapter` / `MarketV1`, not lowercase
  `adapter` / `market` — see `lib/morpho/cap-utils.ts`.
- V1 on-chain parameters: `GET /api/vaults/v1/[id]/parameters` (server multicall),
  not wallet RPC in the browser.
- Allocation tables: optional **USD / Tokens** toggle via `AllocationFilters.amountUnit`
  and `lib/format/allocation-display.ts`; decimals from `lib/format/asset-decimals.ts`
  (USDC 6, WETH 18, cbBTC 8).
- Allocation column **Liquidity** = per-market `liquidityAssetsUsd` (Blue market depth)
  for `MorphoMarketV1Adapter` rows. Not vault-level V2 withdrawable liquidity.
- V2 risk API (`/api/vaults/[id]/risk`) exposes `idleAssets`, `idleAssetsUsd`,
  and per-market scores for **MorphoMarketV1Adapter** positions only.
  `MetaMorphoAdapter` GraphQL rows are **skipped** (Curator vaults do not allocate
  **GraphQL complexity** — the risk query requests
  `oracle.data.baseFeedOne` on **positions only** (not all four feeds, not on caps);
  cap-only markets rely on on-chain `BASE_FEED_*` fallback. **Do not add**
  `sizeUsd`, `totalLiquidityUsd`, or `supplyAssets` to `market.state` in
  `app/api/vaults/[id]/risk/route.ts` — it triggers Morpho “Query is too complex”.
  Risk UI falls back to `supplyAssetsUsd` / `liquidityAssetsUsd` for USD display.

### 4.5 Risk management scoring (V1 & V2)

Both vault versions score **Morpho Blue markets** with the same pure function:
`lib/morpho/compute-blue-market-risk.ts` → `computeBlueMarketRiskScores`. V1 and V2
differ in **how markets are fetched** and **how scores roll up** to vault/adapter
headlines. Do not duplicate scoring math in components or API routes.

#### Per-market score (Blue markets only)

**Formula** (each component ∈ [0, 100], equal 25% weight):

```
marketRiskScore = 0.25 × liquidationHeadroom
                + 0.25 × utilization
                + 0.25 × coverageRatio
                + 0.25 × oracle
```

Then `applyGlobalCaps` may lower the composite before grading:

| Condition | Cap |
| --------- | --- |
| `oracleScore ≤ 20` (missing/opaque oracle) | composite ≤ 76 (**C+** max) |
| `utilizationScore ≤ 20` (very high util) | composite ≤ 79 (**B−** max) |
| `coverageRatioScore < 100` (cannot fully cover shock liquidations) | composite ≤ 83 (**B** max) |

The caps are stated as grades (`RISK_SCORE_CAPS` in
`compute-blue-market-risk.ts`) and derived from the grade floors, so retuning
a floor moves its cap with it. The numbers used to be hardcoded as 54 / 60 / 68,
which on this scale graded F / D / C− instead of the labelled C+ / B− / B.
`getMarketRiskGrade` is the only copy of the scale — market, adapter and vault
grades all import it. Do not re-inline the thresholds elsewhere.

**Missing borrow data:** a market with `borrowAssetsUsd == null` but
`utilization > 0` scores 0 on headroom and coverage (`hasUnknownBorrow`), like
missing state — never "no borrow = safest". Cap-only markets on the V2 risk
route get supply/borrow/collateral USD from `fetch-markets-by-id.ts` so they are
scored on real data.

**Bad debt override:** if `market.realizedBadDebt.usd > 1`, force **grade F** and
**score 0** regardless of components.

**Idle markets** (`isMarketIdle`): no `lltv`, missing collateral, or collateral
symbol `Unknown`. Return `scores: null`; never feed into weighted averages.

**Component details:**

1. **Liquidation headroom** — price shock on collateral: **−2.5%** for same/derivative
   pairs (USDC/USDC, wstETH/ETH, cbBTC/BTC, etc.), **−5%** otherwise.
   `headroom = collateralUsd × shockMultiplier × lltvRatio − borrowUsd`.
   Score tiers on `headroom / borrowUsd`: 0% → 0, 10% → 60, 20% → 80, 30%+ → 100.
   No borrow → 100.

2. **Utilization** — `scoreUtilizationRatio(util, target)` (`lib/morpho/irm-utils.ts`
   supplies target via on-chain IRM kink, default **90%**).
   - At or **below** target → **100** (low util is not penalized).
   - Above target → linear decay to **0** at 100% utilization.

3. **Coverage ratio** — `availableLiquidity = supplyUsd − borrowUsd`;
   `liquidatableBorrow = max(0, borrow − collateral × shock × lltv)`.
   Score from `coverage = availableLiquidity / liquidatableBorrow` (100 at ≥1.0).

4. **Oracle** — Chainlink freshness via `getOracleTimestampData` (`oracle-utils.ts`):
   100 if &lt;1h old; decay to 80 (24h), 60 (1 week), 20 (30d+). No/zero oracle
   address → 20. Valid oracle but no timestamp → 60.

**Letter grades** (`getMarketRiskGrade`, exported from `compute-blue-market-risk.ts`): A+ ≥93, A ≥90, A− ≥87,
B+ ≥84, B ≥80, B− ≥77, C+ ≥74, C ≥70, C− ≥65, D ≥60, F &lt;60.

**External links** — `lib/morpho/morpho-app-links.ts`:
- Blue market → `morphoMarketHref(marketKey)` → `app.morpho.org/base/market/…`
- Curator market detail → `curatorBlueMarketHref(marketKey, chainId)` →
  `/market/blue/{marketKey}?chainId=…`

#### V2 vault risk (Curator)

| Layer | Where | Aggregation |
| ----- | ----- | ------------- |
| Market | `buildMarketRisk` in `risk/route.ts` | Same `computeBlueMarketRiskScores` |
| Adapter | `computeAdapterRisk` | USD-weighted avg of market scores in adapter |
| Vault headline | `risk/route.ts` response | USD-weighted avg of **strategy adapter** scores |

**MorphoMarketV1Adapter:** GraphQL positions → one `buildMarketRisk` per position;
adapter score = `computeWeightedRisk` over non-idle markets with `allocationUsd > 0`.
API returns nested `markets[]` for per-market cards in `VaultRiskV2`.

**Vault score (API):** `vaultRiskScore = Σ(adapter.riskScore × adapter.allocationUsd) /
totalAdapterAssetsUsd` where `totalAdapterAssetsUsd` sums **strategy adapters only**.
**Idle is excluded** from vault score numerator and denominator (UI shows idle as
its own row with “No strategy risk”; it does not dilute or improve the headline).

**Idle row (UI only):** `VaultRiskV2` renders idle from `idleAssets` / `idleAssetsUsd`.
Adapter count KPI = `adapters.length + 1`. Total allocated display =
`totalAdapterAssetsUsd + idleAssetsUsd`.

**Hooks / cache:** `useVaultV2Risk`, `useVaultV2Governance`; keys
`['vault-v2-risk', address]` and `vaultV2GovernanceQueryKey(address)`. Risk and
governance BFF routes use `mergeApiOnChainVaultHeaders()` (`no-store`). Other
BFF routes use `mergeApiCacheHeaders()` (CDN `s-maxage` ≤ 30s). Client hooks
use `apiFetch` (`cache: 'no-store'`); dashboard hooks poll every
`CURATOR_REFETCH_INTERVAL_MS` (30s); on-chain vault hooks refetch on mount,
tab switch, post-tx, and Rebalance (`lib/data/query-config.ts`).

#### Do not regress

- Reuse `computeBlueMarketRiskScores`; do not fork component weights in UI.
- Utilization: **100 at/below IRM target**, not “lower util = safer”.
- V2 vault score **excludes idle** from numerator and denominator.
- GraphQL APY/utilization on the risk route are **fractions (0–1)**; multiply by 100
  before `formatPercentage` in allocation/risk UI.

### 4.6 Monthly income statement (treasury wallet)

**UI** — `app/monthly-statement/page.tsx` (tabs: **By Treasury Wallet** /
**DefiLlama**). Treasury view modes: **Total** (default), By Token, By Vault.
Dashboard overview shows **Total Revenue** and **YTD Revenue** KPIs from treasury
daily token-change (`app/page.tsx`). Toggle treasury vs DefiLlama via
`lib/RevenueSourceContext.tsx` (default: treasury). Home Revenue chart
(`ChartRevenue`) uses the same treasury daily series when source = treasury.

**Treasury API** — `GET /api/monthly-statement-morphoql` thin wrapper around
`computeTreasuryStatement()` in `lib/morpho/compute-treasury-statement.ts`
(shared types/helpers in `lib/morpho/treasury-statement.ts`).

| Field | Meaning |
| ----- | ------- |
| `assets` / `total` | Positive **daily share-balance change** for `TREASURY_ADDRESS` (fee mints + inbound share transfers), converted to underlying tokens and valued at that day's implied USD. Self-deposits (GraphQL `Deposit` where sender is treasury) are subtracted only up to same-day booked income. Opening deposits (including redeem-underlying → deposit-wrapper) are not income and are not subtracted. Price appreciation of a constant share amount is excluded. Outflows are not subtracted. |

**How monthly revenue is calculated**

1. One Morpho GraphQL `userByAddress` query: V1 `vaultPositions.historicalState` +
   V2 `vaultV2Positions.history` (`shares` + `assets` + `assetsUsd`, `interval: DAY`).
   No RPC, ABI, or Alchemy. Self-deposits come from `vaultV2transactions` (GraphQL).
2. For each vault position, sort the DAY series. Income on day *t* =
   `max(shares(t) − shares(t−1), 0)` converted via `assets/shares` that day.
3. USD = share-weight × `assetsUsd(t)`. Do **not** use
   `assetsUsd(t) − assetsUsd(t−1)` (that is mark-to-market).
4. Subtract treasury self-deposits on the same UTC day, capped at that day's
   booked share-increase income. Opening balance on the first history point is
   not income — a self-deposit that created it (e.g. selling underlying shares
   and depositing the wrappers) is not subtracted. Redeems / Rebater outflows
   are not negative revenue.
5. Response always includes `statements`, `daily`, `vaults`, and `warning`. Cached
   30s via `withServerResponseCache` inside `computeTreasuryStatement()` —
   **except** when `warning` is set (treasury self-deposits failed to load or were
   cut off at the page limit, so revenue may be overstated): that result is served
   uncached, the statement page shows the warning, and the dashboard marks
   revenue "may be overstated". Months run from
   the first month with income through the current month, including $0.00 gaps.

**Why the graph can go negative without withdrawals**

It should not from mark-to-market or from moving treasury capital into fee
wrappers. A day can go slightly negative if a self-deposit is subtracted from a
different GraphQL DAY bucket than the share increase. Unmatched opening
deposits are ignored. Outflows are tracked on Rebater, not as negative revenue.

**Scope — what is / isn’t included**

| Included | Excluded |
| -------- | -------- |
| V1 MetaMorpho + V2 vault **token** positions for `TREASURY_ADDRESS` | Loose wallet balances (bare USDC/WETH/cbBTC/ETH) |
| V1 mvUSDC / mvWETH / mvcbBTC (fee accounting only) | Test vaults (`excludeFromBusinessViews`) |
| Business fee wrappers (performance-fee share mints on the wrapper) | |
| Unknown Morpho vaults whose asset is USDC / WETH / cbBTC | Spam / unknown ERC-20s |

**Treasury wallet:** `TREASURY_ADDRESS` in `lib/morpho/treasury-statement.ts`
(`0x057f…266A`, Base Safe). **Start date:** `2025-11-01`.

**DefiLlama tab** — `GET /api/monthly-statement-defillama` (protocol-level fees/revenue;
unrelated to treasury wallet positions).

**Do not regress:** Do not reintroduce a vault-fees vs miscellaneous split in
the treasury dashboard without restoring the tx-classification pipeline in
`treasury-statement.ts`.

### 4.7 Curator Morpho Markets browser

**Routes** — `/markets` (list), `/market/blue/[id]?chainId=` (Blue detail), and
`/midnight/[id]?chainId=` (Midnight detail). Old `/markets/create` and
`/markets/positions` redirect to `/markets`.
**Product toggle** on Browse: **All / Blue — variable rate / Midnight — fixed rate**
(default All, listed-only). Blue is variable rate
([app.morpho.org/variable](https://app.morpho.org/variable),
`MORPHO_VARIABLE_RATE_MARKETS_URL`); Midnight is fixed rate
([markets.morpho.org/fixed](https://markets.morpho.org/fixed),
`MORPHO_FIXED_RATE_MARKETS_URL`).
Midnight is Morpho’s fixed-term (tenor) **order book** — not Blue (no IRM,
utilization, or variable APY). GraphQL does **not** expose it.
`GET /api/markets/midnight` lists books; `GET /api/markets/midnight/[id]`
loads market + state + full book (`https://api.morpho.org/v0/midnight/…`).
External app: [Morpho Markets](https://markets.morpho.org/fixed/base/0x549cd072daf99328554f3a6d2d4d6f4a07f1c59369e891e6391946f9cf75f221)
`https://markets.morpho.org/fixed/{chain}/{marketId}`
(`morphoMidnightMarketHref`). In-app: `curatorMidnightMarketHref`.
Tenor = remaining time to `maturity`. List columns: network, loan, collateral(s),
LLTV, maturity/tenor, lend depth, borrow depth, best lend APR from top ask.
**Browse filters** — Loan, Collateral, and Search apply to **both** Blue and
Midnight (`lib/morpho/market-pair-filter.ts`). Pair queries (`cbBTC/USDC`,
`WETH USDC`) match if every token is a symbol word or prefix (order-independent;
`ETH` does not match `WETH`). A Blue collateral/loan search still hits Midnight
books whose loan + collaterals contain those symbols. Listed / Muscadine stay Blue-only.
Detail KPIs: outstanding units, book depths, best lend/borrow rates, per-collateral
LLTV / liquidation cursor / oracle panel (price, freshness, Chainlink feeds on Base),
asks & bids.
Curator top-nav area holds Curator tools (`/curator`) + Bots + Multisig Safe. Business area:
`/monthly-statement`, `/muscadine-ledger`, `/muscadine-frontends`.

**Wallet positions / lend-borrow** — not in this dashboard. Blue market detail
**Interact** links the Morpho app; Midnight uses **Trade on Morpho**. Writes:
muscadine-onchain (`blue`, `midnight`, `vault deposit|withdraw`).
Midnight lend stays on Morpho’s quote/router
([lend-at-a-fixed-rate](https://docs.morpho.org/developers/midnight/tutorials/lend-at-a-fixed-rate/)).

**BFF** — `GET /api/markets` and `GET /api/markets/[marketId]`
(`lib/morpho/curator-markets.ts`). Midnight: `GET /api/markets/midnight` and
`GET /api/markets/midnight/[id]` (`lib/morpho/midnight-markets.ts`). Networks (same as top-bar wallet): Base,
Ethereum, HyperEVM, Robinhood (`CURATOR_MARKET_NETWORKS`). `/markets`
mirrors the wallet chain (no independent network `<select>`). List query uses
`orderBy: SizeUsd` server-side; client re-sorts via column headers.

**Market size / liquidity (token + USD):**

Display via `TokenUsdValue` / `formatMarketTokenAmount` — **token primary**, USD
muted secondary. Size sorts by `sizeUsd`; Liquidity sorts by `liquidityAssetsUsd`
(the USD value of the token amount shown).

| UI | Token (primary) | USD (secondary) |
| -- | --------------- | --------------- |
| Market size (browser + risk card) | `supplyAssets` (loan) | `sizeUsd` |
| Liquidity (browser + risk card “Available Liquidity”) | `liquidityAssets` (loan) | `liquidityAssetsUsd` |
| Market detail — total liquidity | — (USD only) | `totalLiquidityUsd` |
| Market detail — available liquidity | `liquidityAssets` (loan) | `liquidityAssetsUsd` |
| Supply / borrow / collateral (detail) | paired `*Assets` | paired `*AssetsUsd` |

Do **not** label a USD number as a token amount. Token lines use
`formatRawTokenAmount` + `getTokenDisplayDecimals` (or `formatMarketTokenAmount`).

Vault share % in `MarketRiskDetailCard` still uses `supplyAssetsUsd` internally
(not `sizeUsd`).

Never pair `liquidityAssets` with `totalLiquidityUsd`: the latter also counts
Public Allocator reallocatable liquidity, so it is a different measure.
`totalLiquidityUsd` appears only as its own USD-only “Total liquidity” row on
the market detail page.

**URL filters** — `CuratorMarketsBrowser` syncs `q`, `loan`, `collateral`,
`listed`, `muscadine` both ways: a real navigation (sidebar “Markets”, Back)
resets the filters, and typing writes the URL with `window.history.replaceState`
(no RSC round trip per keystroke). Market links carry `from=` so the detail
page's back link returns there; `safeReturnPath` rejects anything that is not a
same-origin path (`//`, `/\host`, control characters).

**List defaults** — filter **Listed** only; sort **Market size** high → low.
Muscadine rows (blue highlight) = business vault with allocatable market cap on
that `marketId` (30s in-process index in `curator-markets.ts`).

**Detail page** — overview KPIs (APY, bad debt, utilization, supply/borrow),
`MarketOraclePanel` (oracle price vs Morpho spot, Chainlink feed bounds, freshness,
oracle contract link to Basescan/Etherscan/HyperEVMScan via `getAddressScanUrl`),
and `MarketRiskDetailCard` on Base only (oracle/IRM reads use Base RPC today).
`resolveMarketOracleAddress` prefers explicit `oracleAddress` then `oracle.address`
(`lib/morpho/market-oracle-address.ts`). Page title + `Morpho Blue · {network}`
link to Morpho app. Invalid `?chainId=` falls back to Base (`parseCuratorMarketChainId`).

**Allocation tab links** — Blue market row names link to
`curatorBlueMarketHref(marketKey, chainId)` (in-app `/market/blue/…`), not the
Morpho app directly.

**Vault Risk tab links** — `MarketRiskDetailCard` market names link to
`curatorBlueMarketHref(marketKey, chainId)` (`lib/morpho/morpho-app-links.ts`).
Pass `chainId` from the vault page into `VaultRiskV2`.

**Hooks** — `useCuratorMarkets`, `useCuratorMarketDetail` (`lib/hooks/useCuratorMarkets.ts`);
dashboard poll tier (30s).

**Mobile** — filter row uses `flex-wrap`; table is `overflow-x-auto` with
`whitespace-nowrap` sort headers; market detail overview uses responsive
`sm:grid-cols-2 lg:grid-cols-4`. AppShell header/actions already stack on small
viewports.

---

## 5. Reallocation UX Conventions (current code)

These rules are baked into `VaultV2Allocations.tsx`, `VaultV2Sentinel.tsx`,
`AllocationListView.tsx`, and `AllocationFilters.tsx` — preserve them:

### 5.1 List layout (`AllocationListView.tsx`)

- Morpho-style card: header **Allocation | Allocation** (name left, amount right).
- **Sections** (fixed order on V2): Idle → Morpho Vault V2 → Morpho Blue Market.
  Section headers replace per-row type labels.
- **No token icons.** LLTV on Blue rows is a gray pill (`86%`) via
  `formatLltvPill`, not “LLTV 86%”.
- Optional metric columns render as compact extra cells when enabled in filters.
- Column headers are clickable: **high → low**, again **low → high**, again **default**
  (allocated high → low, no header highlight). Same cycle for Name (Z→A / A→Z / default),
  Rate (supply APY), Util., Liquidity, caps, Allocation, and % Alloc. Persists with
  `filters.sort`.
- Edit mode adds a **New** column for target inputs.

### 5.2 Filters (`AllocationFilters.tsx`)

- Single popover for search, idle toggles, sort, **amount unit** (USD / Tokens),
  display mode (amount / percent), and optional columns.
- **Do not** add a separate `UsdTokenModeFilter` on allocation pages — amount
  unit lives only in Filters.
- **Default optional columns ON:** utilization, liquidity, supply APY, allocated.
- **Default optional columns OFF:** borrow APY, effective cap, percent cap.
- Column keys: `effectiveCap` (absolute token cap) and `percentCap` (relative
  WAD on V2).
- Filter preferences persist per vault via `usePersistedAllocationFilters` and
  `lib/allocation/allocation-filters-storage.ts`. Default sort is `default`
  (allocated high → low). Header clicks cycle a column’s desc → asc → `default`
  (`cycleAllocationHeaderSort` in `lib/allocation/allocation-filters.ts`).

### 5.3 Planning & submit

1. **Edit inputs are human-readable strings** parsed with `parseUnits` /
   percentage of `totalRawAssets`.
2. **Cap validation** runs client-side before enabling submit.
   - V2: `target <= absoluteCap` and relative cap vs `firstTotalAssets`
3. **Remaining banner** (`RemainingBanner`):
   - **Planned** = `inputSum` (sum of resolved target inputs), **not** forced to
     `totalRawAssets` after dust adjustment.
   - V2 under-allocation: “X will move to Idle after rebalance” (`implicitIdle`).
   - Uses `formatRawTokenAmount` for token amounts.
4. **V2 submit** batches via `multicall`; deallocates before allocates.
   `DustRecipientSelect` (auto = **Idle**) lets the curator explicitly route the
   unallocated remainder to a strategy target; with `auto` the remainder is
   implicit Idle. Never **auto**-inflate a strategy target to absorb
   under-allocation — only an explicit curator choice may do so, and it still
   passes cap validation. **`TxPreviewDialog`** shows human-readable deltas
   (`lib/morpho/tx-preview.ts`) before the wallet signs.
5. **V2 idle row** — editable for planning; never in `allocate`/`deallocate`
   calldata.
6. Use `formatRawTokenAmount` for all raw bigint display (avoid `1.23e-6`).
7. **APY / utilization from Morpho GraphQL** (V2 risk route): multiply by 100
   before `formatPercentage`.
8. **Sentinel cap decreases** parse via `parseCapDecreaseInput`
   (`lib/morpho/cap-decrease-input.ts`) with inline row errors.
9. **Rebalance freshness** — clicking **Rebalance** awaits
   `refetchRisk()` + `refetchGov()` before edit mode (`beginRebalance` in
   `VaultV2Allocations.tsx`). Partial refresh failure opens edit with a warning;
   hard failure (no cached risk) shows an error and stays read-only. Tx preview
   still calls `finalizeRebalancePlan` for a final on-chain read before sign.
10. **Planning total vs chain total** — `planningTotalRaw` = Σ booked strategy
    `currentAssets` + GraphQL idle (not on-chain `totalAssets`). Relative caps
    still use `chainTotalRaw` (= `totalAssets`). **Max** on a strategy row uses
    deployable idle and sets Idle via `remainingDeployableIdleAfterMax`. **Min**
    (formerly Zero) = `minTargetFromLiquidity` — leave illiquid remainder;
    fully liquid → 0. Helpers live in `lib/onchain/v2-rebalance-plan.ts`.

### 5.4 Adapters & caps tabs

- **Adapters** (`VaultV2Adapters.tsx`): idle row first, then strategy adapters.
  **Allocated** shows decimal token amount + symbol only — no USD line, no
  “Raw: … units”. Pass `assetSymbol` / `assetDecimals` from the vault page.
- **Caps** (`VaultV2Caps.tsx`): Morpho-style grouped tables; compact token
  amounts; utilization rings; Public Allocator view when PA is an allocator.
  Cap edit absolute inputs are human token amounts (`parseUnits`).

---

## 6. Number Formatting Conventions

All helpers live in `lib/format/number.ts`:

- `formatRawTokenAmount(value: bigint, decimals: number, options?)` — decimal
  string with grouping separators, up to `maxFractionDigits` (default 6).
- `formatFullUSD(value: number, options?)` — currency-formatted USD with full
  precision when required.
- `formatCompactNumber`, `formatPercent`, `formatBigIntValue`,
  `formatRelativeCap` — existing helpers for compact KPI displays.
- `lib/format/asset-decimals.ts` — `resolveAssetDecimals`, `getTokenDisplayDecimals`
  for known symbols (USDC 6, WETH 18, cbBTC/BTC 8).
- `lib/format/allocation-display.ts` — `formatAllocationAmount`, `formatCapRawAmount`
  for USD vs raw token display on allocation tables.

Rules:

- Never render raw `bigint` via `.toString()` in the UI.
- Never do floating-point math on token amounts.
- `relativeCap` is WAD-scaled; convert with
  `Number(cap) / 1e18` only for display (`formatRelativeCap` handles this).

---

## 7. Onchain Writes

`lib/onchain/vault-writes.ts` defines typed **V2** write config builders:

- `v2WriteConfigs.allocate(vaultAddress, adapter, data, assets)`
- `v2WriteConfigs.deallocate(vaultAddress, adapter, data, assets)`
- `v2WriteConfigs.multicall(vaultAddress, calls)`
- `v2WriteConfigs.increase/decreaseAbsoluteCap`, relative cap variants

`lib/hooks/useVaultWrite.ts` wraps `wagmi`'s write hooks to expose
`{ write, isPending, isSuccess, error, txHash }`. Always pass a fully-built
config object produced by the helpers above — do **not** hand-roll ABIs in
components.

---

## 8. Error Handling & Observability

- `lib/utils/logger.ts` is the structured logger used by API routes.
- `lib/utils/error-handler.ts` normalizes errors into `{ message, code, statusCode }`
  JSON. `AppError` messages pass through; any other error goes through
  `publicErrorMessage` (viem `shortMessage`, first line only, URLs replaced,
  configured secrets redacted) because viem RPC errors embed the request URL —
  which carries the server Alchemy / CDP key. The full error is logged server-side.
- Client hooks read failed BFF responses with `apiErrorMessage(res, fallback)`
  (`lib/data/api-fetch.ts`) — the `{ message | error }` field, not the raw body.
- Integer query params go through `parseBoundedIntParam` (`lib/api/query-params.ts`)
  so junk never reaches GraphQL variables or cache keys.
- `GET /api/vaults/[id]` returns **502** when Morpho GraphQL fails — only a vault
  that is genuinely not indexed gets the "Unknown V2 Vault" placeholder.
- `components/ErrorBoundary.tsx` catches render errors.
- For reallocation failures, surface:
  - Cap validation messages inline next to inputs
  - A top-level alert containing the revert reason (use `error.shortMessage`
    from viem when available)
- When adding new write flows, always add a UI path for the `error` state.

---

## 9. Auth & Gating

- Curator tools routes: `/markets`, `/market/blue/[id]`, `/midnight/[id]`, `/safe`, `/curator`,
  `/monthly-statement`, etc. Entire app is behind `AuthGuard` in `app/providers.tsx`.
- Server auth: `POST /api/auth/verify` sets an HttpOnly `curator_session`
  cookie (HMAC). Two limits: `AUTH_LOGIN_MAX_ATTEMPTS` / 15 min per client, and
  `AUTH_LOGIN_GLOBAL_MAX_ATTEMPTS` / 1 min across all clients. Every attempt is
  charged **before** the body is read — `consumeRateLimit` checks and increments
  in one synchronous step, so concurrent requests cannot all pass a check before
  any of them counts. A successful login clears both buckets, so charging every
  attempt costs a legitimate admin nothing. The client bucket is charged first
  and returns early, so an already-locked-out client cannot drain the global
  budget.
  The per-client bucket keys off `resolveClientIp()`; when the IP is **not**
  trustworthy every such request shares one `untrusted` bucket, because
  `x-forwarded-for` is caller-controlled and rotating it would otherwise mint a
  fresh bucket per guess. Set `CURATOR_TRUSTED_PROXY_HOPS` to the number of
  proxies in front of the app (Cloudflare + Vercel = 2) to get real per-IP
  limits. The global window is short on purpose: any global counter is a lockout
  an attacker can hold open, so recovery takes under a minute.
- **Never trust `cf-connecting-ip` (or any single vendor header) as proof of
  origin.** Any caller can send it; it only means something if every request
  provably transited that vendor. Cloudflare appends the real client IP to
  `x-forwarded-for`, so hop counting already covers that deployment. An earlier
  revision of this fix trusted `cf-connecting-ip` whenever a hop count was set,
  which silently reopened the exact bypass it was meant to close.
- If `CURATOR_TRUSTED_PROXY_HOPS` is set **higher than the real number of
  proxies**, or the origin is reachable without passing through them, per-IP
  limits become forgeable again. The global cap is the backstop for that case
  and bounds guessing to ~50/min. Login rate limits use Upstash REST when
  `UPSTASH_REDIS_REST_*` are set (shared across isolates); otherwise they are
  per-instance memory.
- HMAC uses `CURATOR_SESSION_SECRET` when set, otherwise
  `CURATOR_ADMIN_PASSWORD` (same in production and development).
  Bump `CURATOR_SESSION_VERSION` to invalidate sessions. `proxy.ts` requires the cookie on `/api/*` except
  `/api/auth/verify`, `/api/auth/me`, `/api/auth/logout`.
  `GET /api/auth/me` is the session check. LocalStorage is not a session.
  Each BFF also calls `unauthorizedUnlessAdmin` (proxy is not an auth
  boundary).
- The **only** username is **`admin`** (case-sensitive, role `'admin'`);
  password from env `CURATOR_ADMIN_PASSWORD` (legacy `CURATOR_OWNER_PASSWORD`
  still accepted as fallback; must be uncommented in `.env.local`; server
  restart required after changes).
- Write UI (reallocate, caps, etc.) is gated on both wallet connection and
  curator role.
- **All on-chain writes** (V1/V2 reallocate, caps, etc.) go through
  **Reown AppKit → connected wallet** (`useVaultWrite` / wagmi `writeContract`).
  Do not add server-side private keys for allocation flows.
- **Multisig Safe writes** — when a vault's on-chain allocator/sentinel is a
  Muscadine Safe (`lib/safe/config.ts`), queue proposals from Allocation /
  Sentinel preview dialogs; owners sign EIP-712 on `/safe/[role]`.
  Direct wallet confirm remains for EOA role holders only (`lib/safe/vault-role-match.ts`).
- Wallet connect lives in the **topbar** (`ConnectWalletButton` / Reown
  AppKit). Featured wallets are configured in `lib/wallet/appkit.ts`. Chain
  switching for the **app network** is the top-bar `NetworkSwitcher`; the
  AppKit account modal can still switch the wallet chain.

---

## 10. Common Pitfalls & Playbook

### V1 reallocation reverts with `InconsistentReallocation`

- Confirm the last deposit's `assets` is `maxUint256`.
- Confirm withdrawals come before deposits in the array.
- Confirm no rounding error in human → raw conversion (`parseUnits` with the
  right decimals).
- Confirm the sum of planned deltas is reasonable vs current idle + supply.

### V2 allocation planning shows full vault total as “planned”

- **Symptom:** User edits one row (e.g. 50 USDC) but banner says
  `planned 109,475 / 109,475` and “45k rounding applied to largest non-idle target.”
- **Cause:** Empty rows kept **current** allocations; `applyPlanningDust` forced
  sum to `totalRawAssets` by inflating the largest strategy target.
- **Fix:** Banner uses `inputSum`. Do not dust-balance partial edits onto
  strategy rows; under-allocation is implicit Idle. See §3.2 and §5.3.

### V2 Sentinel decrease-cap or deallocate reverts

- Confirm cap `idData` uses prefixed encoding from `lib/morpho/v2-id-data.ts`
  (§3.2 table) — **not** bare `abi.encode(address)` or raw `marketParams`.
- For market caps, confirm `cap.adapterAddress` from governance and full market
  params (oracle, irm, lltv) from the risk API are used in
  `encodeMarketCapIdData`.
- Deallocate Blue markets: `data = encodeMarketParamsData(market)`.
- New absolute/relative cap on decrease must be **≤ current** on-chain cap.
- Relative cap input is human **percent** (0–100); convert to WAD with
  `BigInt(Math.round(pct * 1e16))`.
- Use `parseHumanTokenInput` for deallocate amounts (comma-safe), not raw
  `parseUnits` on un stripped strings.
- Sentinel writes require a connected wallet with the **Sentinel** role (or
  Curator for some actions). Connect via topbar — Sentinel tab does not duplicate
  Connect Wallet (`suppressConnectPrompt` on `TransactionButton`).

### V2 allocation reverts

- Check `absoluteCap` and `relativeCap` — both enforced on-chain per id.
- Check adapter identity and that `idData` encodes the right market/vault.
- When batching, the order inside `multicall` matters if `deallocate` must
  precede `allocate` to free up balance in the vault.
- **Tiny Blue positions** (e.g. 1 raw unit) may fail to `deallocate` on-chain
  even when the UI builds valid calldata — adapter/market liquidity constraints.

### V2 writes must use a connected allocator wallet

- The app never reads allocator private keys from env. Connect Rabby (or another
  configured wallet) on Base before clicking Rebalance / cap submits.

### Numbers rendering as `1.23e-6` or losing precision

- You're doing `Number(bigint) / 10 ** decimals` somewhere. Switch to
  `formatRawTokenAmount`.

### "Vault not found" on detail pages

- Address missing from `lib/config/vaults.ts` or from env `NEXT_PUBLIC_VAULT_*`.
- API route `/api/vaults/[id]` returns 404 if the vault isn't tracked.

### Vault liquidity vs idle vs deployed (Morpho API)

- **Vault liquidity** = Morpho `liquidityUsd` / `liquidity` (withdrawable). Never
  derive as `TVL − idle` for display or history.
- **Idle** = unallocated vault balance (`idleAssetsUsd` on V2).
- **`realAssetsUsd` in `VaultV2History`** ≈ deployed (TVL − idle), not withdrawable.
- **Historical liquidity** is not on `VaultHistory` or `VaultV2History`; only spot
  fields on `vaultByAddress` / `vaultV2ByAddress`.

### V1 vault page fails to load / empty GraphQL

- Ensure `warnings` is queried on the vault object, not nested under `state`.

### V2 cap validation always fails

- Match caps with `isAdapterCap` / `isMarketCap` in `cap-utils.ts` (`Adapter`, `MarketV1`).

### V2 allocations show wrong APY or dashes for utilization/borrow

- Risk route returns GraphQL APY/utilization as **fractions** (0–1). UI must
  `× 100` before `formatPercentage`. Do not hardcode `—` for market metrics.
- Confirm `market.state { utilization, supplyApy, borrowApy, liquidityAssetsUsd }`
  is queried on MorphoMarketV1Adapter positions in `VAULT_V2_RISK_QUERY`.

### V2 MetaMorpho adapter on-chain (should not happen)

- Curator **skips** `MetaMorphoAdapter` in risk, allocation, sentinel, and adapters
  tabs. If a vault still holds MetaMorpho allocation on-chain, it will not appear in
  rebalance UI and is omitted from `vaultRiskScore` / idle overlay. Strategy vaults
  use Morpho Blue market adapters; fee wrappers use `MorphoVaultV2Adapter` (not MetaMorpho).

### Fee wrapper GraphQL missing underlying vault

- Query `... on MorphoVaultV2Adapter { innerVault { address name } }` on adapters and
  `liquidityAdapter` (Morpho field name). Allocate/deallocate `data` must be `0x`. Do not sum wrapper TVL
  into protocol stats. `avgNetApy` is often null until history accumulates — use `netApy`.

### V2 adapter count wrong in Risk

- Count is **strategy adapters + 1** (idle). Idle is not returned in
  `adapters.items` from GraphQL but must be included in the KPI.

### Risk score looks wrong after utilization/oracle changes

- Per-market math lives only in `lib/morpho/compute-blue-market-risk.ts`. Utilization
  uses `scoreUtilizationRatio`: optimal at IRM target (~90%), not “lower is safer”.
- V2 vault headline **ignores idle**; only Blue market adapter allocations weight
  `vaultRiskScore`.
- Realized bad debt &gt; $1 forces market grade **F** / score **0**.

### Pending tab visible with nothing to accept

- V2: pending embeds in **Caps** tab (count in tab label); Sentinel shows a
  read-only pending section with empty state. No standalone Pending tab on V2.
- V1: hide the tab when `pending.length === 0`.

### Markets browser shows wrong size ranking

- Use Morpho `state.sizeUsd` for market size. The liquidity column shows
  `liquidityAssets` with its own `liquidityAssetsUsd` and sorts by that USD —
  not `totalLiquidityUsd`, which is a different (Public Allocator–inclusive)
  measure.
  See §4.7.

### GraphQL deprecation warnings in server logs

- `morphoGraphQLClient` logs `extensions.warnings`. Migrate fields per §4.4.1
  (`oracle.address`, `vaultV2transactions`, `marketId` / `marketKey`).

### Vault list empty or only V2 Prime in sidebar

- Check server logs for `GraphQL Error: Cannot query field "whitelisted"` or
  `"uniqueKey"` — update queries per §4.4.1.
- V1 batch query uses `.catch(() => ({ items: [] }))`; one invalid field drops
  **all** V1 vaults from the list without surfacing an error to the UI.
- Hard-refresh or bump `useVaultList` / `useVaultHistory` query keys after schema fixes.
- Confirm sidebar network **Base** is expanded (vaults are chainId `8453` only).

### History chart crashes on “Price per share”

- Stale React Query payload may lack `series.sharePrice` / `sharePriceUsd`.
  `normalizeVaultHistoryResponse()` in `useVaultHistory` backfills `[]`; chart
  uses `?? []` defensively.

---

## 11. Development Workflow

```bash
npm install
npm run dev            # next dev
npm run lint           # eslint . --max-warnings=0
npm run typecheck      # or: npx tsc --noEmit
npm run build
```

### ESLint

- **Pin ESLint 9** — `eslint@^9.39.4` and `@eslint/js@^9.39.4`. Do **not** upgrade to
  ESLint 10 while using `eslint-config-next`; transitive plugins (`eslint-plugin-react`,
  etc.) still break on removed ESLint 10 APIs.
- **Pin wagmi 2** — `@reown/appkit-adapter-wagmi` peers `wagmi@2`. Do not
  upgrade to wagmi 3 until AppKit supports it.
- **Pin TypeScript 6** — `typescript-eslint` peers `typescript <6.1.0` for the
  tooling path used by `eslint-config-next`; stay on `typescript@^6.0.x` (not 7).
- **`sharp` override** — Next still optional-deps `sharp@^0.34.5`; override to
  `>=0.35.3` for GHSA-f88m-g3jw-g9cj (libvips CVEs).
- **`eslint.config.mjs`** — official Next.js flat config:
  `eslint-config-next/core-web-vitals` + `eslint-config-next/typescript` (lints all
  `.ts`/`.tsx`, not just `.js`).
- **React Compiler advisory rules** (`react-hooks/set-state-in-effect`, `purity`, …)
  are **off** in `eslint.config.mjs` until a deliberate compiler migration.
- **`npm run lint`** fails on any warning (`--max-warnings=0`).

### Conventions

- Keep components typed. Prefer `ReadonlyArray<T>` for inputs and explicit
  `interface` for props.
- Server-side code goes in `app/api/*` route handlers or `lib/**/*.server.ts`
  modules; never import `wagmi`/viem-wallet code in server files.
- Use `lib/format/number.ts` helpers for all numeric display.
- Don't hardcode vault addresses in components — always import from
  `lib/config/vaults.ts` or receive via props from the route.
- When touching allocation logic, **re-read Section 3 and Section 5** before
  making changes and keep this file in sync.

---

## 12. Quick Reference: Key Files to Know

| Concern                          | File                                                     |
| -------------------------------- | -------------------------------------------------------- |
| V2 allocation UI + allocate/etc. | `components/morpho/VaultV2Allocations.tsx`              |
| Tx preview dialog + builders     | `components/morpho/TxPreviewDialog.tsx`, `lib/morpho/tx-preview.ts` |
| Allocation list shell + sections | `components/morpho/AllocationListView.tsx`               |
| Allocation filter persistence  | `lib/allocation/allocation-filters-storage.ts`, `usePersistedAllocationFilters.ts` |
| V2 adapters UI (incl. idle)      | `components/morpho/VaultV2Adapters.tsx`                 |
| V2 caps UI (read-only + pending) | `components/morpho/VaultV2Caps.tsx`                      |
| V2 Public Allocator reads        | `lib/morpho/v2-public-allocator.ts`                     |
| V2 roles / timelocks UI          | `components/morpho/VaultV2Roles.tsx`, `VaultV2Timelocks.tsx` |
| V2 Sentinel UI + writes          | `components/morpho/VaultV2Sentinel.tsx`                  |
| Cap decrease input parsing     | `lib/morpho/cap-decrease-input.ts`                       |
| V2 cap idData encoding           | `lib/morpho/v2-id-data.ts` (`resolveCapIdData`, …)       |
| V2 cap display helpers           | `lib/morpho/v2-cap-format.ts`                            |
| Market risk scoring (shared)     | `lib/morpho/compute-blue-market-risk.ts`, `lib/morpho/irm-utils.ts`, `lib/morpho/oracle-utils.ts` |
| V2 risk API + UI                 | `app/api/vaults/[id]/risk/route.ts`, `VaultRiskV2.tsx`, `MarketRiskDetailCard.tsx` |
| Morpho app deep links            | `lib/morpho/morpho-app-links.ts`                         |
| V2 pending UI                    | `components/morpho/VaultV2Pending.tsx`                    |
| V2 vault page (tabs)             | `app/vault/[address]/page.tsx`                            |
| Fee wrapper tab                  | `app/vault/[address]/fee-wrapper/page.tsx`, `FeeWrapperPanel.tsx`, `GET /api/vaults/[id]/gates` |
| Blue market types + normalize      | `lib/morpho/blue-market-data.ts` (`asBlueMarketData`) |
| Client fetch + refetch interval  | `lib/data/api-fetch.ts`, `lib/data/query-config.ts`      |
| BFF cache headers                | `lib/api/response-cache.ts`, `lib/api/server-response-cache.ts` |
| Governance query key helper      | `vaultV2GovernanceQueryKey` in `lib/hooks/useVaultV2Governance.ts` |
| Wallet / Reown AppKit config     | `lib/wallet/config.ts`, `lib/wallet/appkit.ts`, `app/providers.tsx`, `components/ConnectWalletButton.tsx` |
| Shared filters UI                | `components/morpho/AllocationFilters.tsx`               |
| Number formatting                | `lib/format/number.ts`                                   |
| ABIs                             | `lib/onchain/abis.ts` (V2 only)                          |
| Write configs                    | `lib/onchain/vault-writes.ts` (V2 only)                  |
| Planning dust helper             | `lib/onchain/allocation-dust.ts` (`applyPlanningDust`)   |
| Dust recipient UI                | `components/morpho/DustRecipientSelect.tsx`              |
| Write hook                       | `lib/hooks/useVaultWrite.ts`                             |
| V2 data hook                     | `lib/hooks/useVaultV2Complete.ts`                        |
| V2 caps API                      | `app/api/vaults/[id]/governance/route.ts`             |
| Vault overview + history chart   | `components/morpho/VaultOverviewPanel.tsx`, `VaultOverviewHistoryChart.tsx`, `TokenUsdValue.tsx` |
| Vault history BFF                | `app/api/vaults/[id]/history/route.ts`, `lib/morpho/vault-history.ts` |
| Treasury monthly statement       | `app/api/monthly-statement-morphoql/route.ts`, `lib/morpho/compute-treasury-statement.ts`, `lib/morpho/treasury-statement.ts`, `app/monthly-statement/page.tsx` |
| V2 cap market enrichment         | `lib/morpho/fetch-markets-by-id.ts` (`enrichMarketCapParams`, `enrichCollateralCapSymbols`) |
| Vault overview analytics         | `lib/morpho/vault-analytics.ts`                          |
| Chart metric / unit filters      | `components/charts/MetricModeFilter.tsx`, `UsdTokenModeFilter.tsx` |
| Asset decimals + allocation fmt  | `lib/format/asset-decimals.ts`, `allocation-display.ts` |
| V2 cap helpers                   | `lib/morpho/cap-utils.ts`, `lib/morpho/vault-v2-governance-map.ts` |
| Vault list API                   | `app/api/vaults/route.ts`, `app/api/vaults/[id]/route.ts`|
| Vault history + share price      | `lib/morpho/vault-history.ts`, `useVaultHistory.ts`, `VaultOverviewHistoryChart.tsx` |
| Sidebar vault sections           | `components/layout/Sidebar.tsx`, `lib/config/vaults.ts` (`getSidebarNavVaults`) |
| Market id helpers                | `lib/morpho/morpho-app-links.ts` (`marketKeyFromGraphQL`, `curatorBlueMarketHref`, `curatorMidnightMarketHref`, `morphoMidnightMarketHref`) |
| Midnight markets                 | `lib/morpho/midnight-markets.ts`, `app/midnight/[id]/page.tsx`, `GET /api/markets/midnight`, `GET /api/markets/midnight/[id]` |
| Oracle address from GraphQL      | `lib/morpho/market-oracle-address.ts` (`resolveMarketOracleAddress`) |
| Morpho GraphQL client + warnings | `lib/morpho/graphql-client.ts` |
| Curator markets BFF + scoring    | `lib/morpho/curator-markets.ts`, `app/api/markets/` |
| Markets browser UI               | `components/morpho/CuratorMarketsBrowser.tsx`, `lib/morpho/market-pair-filter.ts`, `app/markets/page.tsx` |
| Market detail + oracle panel     | Blue: `app/market/blue/[id]/page.tsx`; Midnight: `MidnightMarketView` + `MarketOraclePanel`; `lib/morpho/oracle-price.ts` |
| Create Blue market / vault deposit | muscadine-onchain CLI (not this dashboard) |
| Amount MAX (Safe send/receive)   | `components/morpho/AmountMaxInput.tsx` |
| Nav areas                        | `lib/nav/areas.ts`, `components/layout/Topbar.tsx`, `Sidebar.tsx` |
| Oracle Portal link               | `MORPHO_ORACLE_PORTAL_URL` in `lib/constants/links.ts` → https://oracles.morpho.dev/ |
| Brain / session loop             | `docs/brain/`, `.cursor/rules/muscadine-brain.mdc`, `.cursor/mcp.json` |
| V2 on-chain allocation overlay   | `lib/morpho/overlay-v2-onchain-caps.ts` |
| V2 tx user resolution            | `lib/morpho/vault-v2-transaction-utils.ts` |
| Vault addresses                  | `lib/config/vaults.ts`                                   |
| Theme context + migration        | `lib/theme/ThemeContext.tsx`                             |
| Theme switcher UI                | `components/ThemeSwitcher.tsx`                           |
| Global density + theme vars      | `app/globals.css`                                        |
| Chart time-range filter          | `components/charts/TimeRangeFilter.tsx`                  |
| Chart cumulative/daily toggle    | `components/charts/ViewModeFilter.tsx`                   |
| Chart total/by-vault toggle      | `components/charts/SourceModeFilter.tsx`                 |
| Vault holders (paginated)        | `components/morpho/VaultHolders.tsx`                     |
| Vault transactions (paginated)   | `components/morpho/VaultTransactions.tsx`                |
| Holders API (V1/V2)              | `app/api/vaults/[id]/holders/route.ts`                   |
| Transactions API                 | `app/api/vaults/[id]/transactions/route.ts`              |
| Multisig Safe UI + queue         | `app/safe/`, `components/safe/*`                          |
| Safe config + Protocol Kit       | `lib/safe/config.ts`, `lib/safe/protocol-kit-client.ts`  |
| Safe pending store (localStorage)| `lib/safe/pending-store.ts`, `lib/safe/queue-vault-write.ts` |
| Safe Transaction Service         | `lib/safe/transaction-service.ts`, `lib/safe/service-sync.ts` |
| Safe API rate limit (client)     | `lib/safe/transaction-service-rate-limit.ts`             |
| Safe Apps SDK                    | `lib/safe/safe-apps-context.tsx`, `public/manifest.json` |
| Safe vault write routing         | `lib/safe/vault-role-match.ts`, `lib/safe/build-vault-calldata.ts` |
| Safe calldata preview            | `lib/safe/decode-vault-calldata-preview.ts`              |
| Safe post-execute refetch        | `lib/safe/refetch-vault-after-safe-execute.ts`           |
| Safe on-chain info API           | `app/api/safe/[address]/info/route.ts`, `lib/safe/onchain-reads.ts` |

---

## 13. Multisig Safe (Curator)

`/safe` manages Muscadine role Safes on Base. Default tab: `/safe/allocator`. Under
top-nav **Curator**: Curator tools → Bots → Multisig Safe.

### 13.1 Role Safes (`lib/safe/config.ts`)

| Role | Purpose |
| ---- | ------- |
| Owner | Owner multisig |
| Curator | Curator multisig |
| Allocator | Vault rebalances queued here |
| Sentinel | Cap decreases + deallocations queued here |
| Treasury | Treasury multisig |

Workspace link: Muscadine Labs on `app.safe.global` (`lib/safe/links.ts`).

### 13.2 Transaction flow

1. **Queue** — From a vault **Allocation** or **Sentinel** tab, use the tx
   preview dialog. When governance lists the Muscadine Allocator/Sentinel Safe as
   the vault role holder, the dialog is **Safe-only** (`vault-role-match.ts`).
   Queue builds a Safe meta-tx via Protocol Kit (RPC) and stores it in
   **browser localStorage** (`pending-store.ts`). With `NEXT_PUBLIC_SAFE_API_KEY`
   and a connected proposer wallet, auto-share also signs EIP-712 and proposes
   to the Transaction Service; Safe App embed uses `sdk.txs.send` instead.
2. **Sign** — On `/safe/[role]`, connect a **Safe owner** hot wallet in
   the topbar. **Sign (EIP-712)** adds owner signatures locally. Sign, Share and
   auto-share rebuild the Safe tx from its stored fields and check it hashes to
   the stored `safeTxHash` **before** signing — a service-imported row carries
   the service's hash next to separate `to`/`data`, and the owner reads a
   preview decoded from `data`.
3. **Execute** — Once signatures ≥ threshold, **any connected wallet** may
   **Execute on-chain** (`execTransaction` is permissionless); owners are only
   required to **sign**. The **Safe address** calls the vault contract.
   `executeSafePendingTransaction` returns `execTransaction` calldata that the
   wagmi wallet sends with **`value: 0`** — never the inner tx's value, or the
   executor pays for ETH the Safe sends out. It re-checks the on-chain threshold
   and the Safe's ETH balance first (protocol-kit's own pre-checks). The row is
   marked **executed only after the receipt succeeds**; a revert keeps it queued
   (and its nonce reserved) with the hash linked. Then Curator refetches vault
   risk, governance, pending, reallocations, overview, and the Safe header/assets
   (`refetch-vault-after-safe-execute.ts` — matches query keys by address
   **case-insensitively**; vault pages key on lowercase config addresses).
   Wallet/chain/threshold errors surface on the row; a ref guard stops a
   double-click from starting two executions.

Export/import JSON shares proposals between owners/browsers.

**Dual storage model** — localStorage is always the source of truth in Curator;
Transaction Service is an optional sync layer:

1. **Queue** always writes to localStorage first.
2. **Auto-share** (when `NEXT_PUBLIC_SAFE_API_KEY` is set and a proposer wallet is
   connected): signs EIP-712 and calls `proposeTransaction` via
   `@safe-global/api-kit` (^5.x; same `proposeTransaction` / `confirmTransaction`
   surface used by Allocation and Sentinel queue flows).
3. **Safe App embed** (`CuratorSafeAppsProvider`): when opened inside
   `app.safe.global`, queue can call `sdk.txs.send` after building the same
   meta-tx locally; marks `serviceSynced`.
4. **Sync from service** on `/safe/[role]` merges pending txs from the
   Transaction Service into localStorage (signatures included).
5. **Share with owners** on unsynced rows re-proposes to the service.
6. **Sign** posts `confirmTransaction` to the service when `serviceSynced` is true.

`public/manifest.json` uses `iconPath`: `muscadinelogo.svg` (embedded JPEG, same
pixels as `muscadinelogo.jpg`) + CSP `frame-ancestors`
allow Safe App listing. Env: `NEXT_PUBLIC_SAFE_API_KEY` (https://developer.safe.global).
Free tier is **5 req/s** and **50K req/month** — Curator only calls the service on
queue (propose), sign (confirm), share, and manual **Sync from service** (no polling);
client serializes calls with ≥210ms spacing.

### 13.3 API

- `GET /api/safe/[address]/info` — owners, threshold, nonce, version, native
  ETH balance (`ethBalance` raw string), and Transaction Service **proposers**
  (delegates who can propose without being owners). Proposers require
  `NEXT_PUBLIC_SAFE_API_KEY`; returns `proposersConfigured: false` when unset.
  Cached ≤15s. Reads are one **multicall**, not four `eth_call`s.
- `GET /api/safe/[address]/balances?tokens=0x…,0x…` — on-chain balances for the
  curated token set (native ETH, USDC/WETH/cbBTC, every configured vault's
  shares) plus any comma-separated extra addresses. One multicall; unknown
  tokens also resolve `symbol`/`name`/`decimals` in the same batch and are
  dropped if the reads fail. Cached ≤15s. There is **no** Safe Transaction
  Service balances call — the free tier is 5 req/s and this route is on the
  hot path.
- `GET /api/safe/[address]/history` — executed multisig txs from the Transaction
  Service (`getMultisigTransactions`, executed only). On-demand; same rate
  limit. Requires `NEXT_PUBLIC_SAFE_API_KEY`.
- `GET /api/safe/[address]/settings` — on-chain modules + guard
  (`readSafeOnChainSettings`). Address book is client-only
  (`lib/safe/address-book.ts`).
- `GET /api/gates/[address]` — live WhitelistSendAssetsGate state for a
  configured gate. Writes are Safe-only via `/curator/gates`. The gate has no
  on-chain enumeration, so candidates = configured addresses ∪ every account in
  its `SetIsWhitelister` / `SetIsWhitelisted(WithSig)` events
  (`lib/morpho/send-assets-gate-roster.server.ts`); the live `isWhitelisted` /
  `isWhitelister` mappings then decide the lists. The event scan walks history
  in 2,000-block chunks (public Base RPC cap) for at most 6s per request, keeps
  progress in memory, and reports `rosterScan: { status, progress }`; the panel
  polls while `scanning`, warns on `failed`, and lists accounts whose reads
  failed instead of dropping them. Start block: built-in for the default gate,
  `SEND_ASSETS_GATE_DEPLOY_BLOCK` for a redeploy, else `eth_getCode` bisection.

### 13.3.1 Assets, send and receive

`/safe/[role]` is five route segments — **Home** (`page.tsx`, owners/proposers/
details), **Assets** (`assets/`), **Transactions** (`transactions/`, the queue),
**History** (`history/`, executed txs), **Settings** (`settings/`, modules,
guard, address book)
— under a shared `layout.tsx` that renders `SafeAccountHeader` (chain-prefixed
`base:0x…` address, copy, threshold, ETH balance, Send/Receive) and
`SafeRoleSubnav`.

- **Send from a Safe** is a normal Safe proposal: `buildSafeTransferCalldata`
  emits a native value transfer or an ERC-20 `transfer`, `queueSafeTransfer`
  wraps it via `queueSafeTransaction`, and it then follows the existing
  queue → sign → execute path. Available on **all five roles** — a proposal
  confers no privilege on its own. Operation is always `Call`, never
  `DelegateCall`.
- **Receive** shows a QR of the `base:`-prefixed address plus a direct
  wallet → Safe transfer (`useSafeFunding`), which needs no signatures.
- **Balances** are read on-chain only. A Safe can hold any token, so unknown
  ones are added by address and persisted per role in localStorage
  (`custom-token-store.ts`) — there is no indexer to enumerate them.
- Safe amounts render with `SAFE_AMOUNT_DP` (6), not the app-wide default of 2:
  an ETH gas float and share dust both round to `0.00` at two places.
- Vault-share rows use the **vault name** as the symbol — several vaults share
  an asset, so `USDC shares` cannot tell two balances apart.

### 13.4 Key files

| Concern | File |
| ------- | ---- |
| Queue any Safe tx | `lib/safe/queue-vault-write.ts` (`queueSafeTransaction`, `queueSafeBatch`) |
| Queue from vault | `lib/safe/build-vault-calldata.ts` |
| Queue a transfer | `lib/safe/queue-transfer.ts`, `build-transfer-calldata.ts` |
| Token registry + balances | `lib/safe/tokens.ts`, `read-balances.ts`, `custom-token-store.ts` |
| Assets / send / receive UI | `components/safe/SafeAssetsPanel.tsx`, `SafeSendDialog.tsx`, `SafeReceiveDialog.tsx`, `SafeModal.tsx` |
| History / settings UI | `components/safe/SafeHistoryPanel.tsx`, `SafeSettingsPanel.tsx`, `lib/safe/address-book.ts` |
| Safe page shell | `app/safe/[role]/layout.tsx`, `components/safe/SafeAccountHeader.tsx`, `SafeRoleSubnav.tsx` |
| Fund a Safe from a wallet | `lib/hooks/useSafeFunding.ts` |
| Calldata preview decode | `lib/safe/decode-vault-calldata-preview.ts` |
| Post-execute refetch | `lib/safe/refetch-vault-after-safe-execute.ts` |
| Sign / execute | `lib/safe/protocol-kit-client.ts` |
| Transaction Service sync | `lib/safe/transaction-service.ts`, `lib/safe/service-sync.ts` |
| API rate limit | `lib/safe/transaction-service-rate-limit.ts` |
| Safe Apps SDK | `lib/safe/safe-apps-context.tsx`, `public/manifest.json` |
| UI queue | `components/safe/SafeTransactionQueue.tsx` |
| Hooks | `useSafeInfo`, `useSafeBalances`, `useSafePending`, `useSafeTransactionActions` |

### 13.5 Do not regress

- Rebuild Safe tx with stored nonce/gas before **sign and** execute; verify `safeTxHash`.
- Execute sends `value: 0`; mark executed only on a successful receipt.
- DelegateCall hazards (`lib/safe/multisend.ts`, `safePendingWarnings`): a
  DelegateCall to anything but a canonical Base MultiSend / MultiSendCallOnly,
  or a nested DelegateCall inside a MultiSend, is shown in red and **blocked**
  from sign/share/execute. `inferSafeTxSource` never labels a DelegateCall as a
  transfer or vault write. MultiSend batches get a per-call decoded preview.
- Vault `multicall` / `submit` inner calls the Vault V2 ABI cannot decode are
  kept in the preview (ERC-20 calls named) and warned on the card — never
  silently dropped.
- A MultiSend batch must include the **last** queued nonce for that Safe
  (`prepareSafeBatchSelection(txs, queue)`): folding N rows into one nonce
  frees N−1 nonces and would strand any later signed proposal forever.
- Bundle import merges signatures into a proposal already held locally
  (union by signer) instead of overwriting it.
- Send's address-book upsert passes an empty label, which keeps an existing
  saved label (`upsertAddressBookEntry`).
- Safe Receive shows Confirmed only for a successful receipt; Failed otherwise.
- V2 calldata: deallocates before allocates in multicall batches.
- Cap preview amounts use asset display decimals (`formatCapRawAmount` in
  `allocation-display.ts`), not zero decimal places.
- localStorage remains authoritative; Transaction Service sync is additive.
- Do not drop export/import when adding service features.
- Queue cards always show a tx preview — stored preview or decoded vault calldata.
- A `transfer` source must not resolve to a vault link: an ERC-20 share transfer
  targets the vault contract but is not a vault operation
  (`resolveVaultAddressFromPending`).
- `initSafeProtocolKit` caches only the **read-only** kit (fixed Base RPC, so it
  cannot go stale); a failed init must be evicted or every later call replays
  the error. Never cache a signer-bound kit — it captures the wallet's chain id
  at init and would sign for the wrong chain after a network switch.
- Dialogs that carry a preselection (`SafeSendDialog`) must mount only while
  open. Left mounted, `useState(initialToken)` keeps the first mount's value and
  every later launch preselects the wrong asset.
- Post-queue redirects go to `/safe/[role]/transactions`, not `/safe/[role]`.
- Next Safe nonce comes from on-chain **plus** queued local proposals
  (`resolveNextSafeNonce`) so two queued txs cannot share a nonce.
- Sign/execute use the AppKit/wagmi provider and switch to Base first.
- Over-allocated rebalance plans fail closed (do not trim then submit).
- Sentinel deallocate requires booked `allocation(id)` and market params
  (`data` is never `0x` for a Blue market).

---

## 14. CCTP (removed)

CCTP helpers and any `/cctp` page are **not in this branch**. Do not document or
import `lib/cctp/` until Cross-Chain Transfer is reintroduced under Later.

---

## 15. Repo Hygiene — Known Dead Code / Bloat

`knip` was run on 2026-04-24 to audit imports. Summary:

- **No unused files** — all source files are referenced.
- **Unused direct deps** — none flagged at last knip run after Reown AppKit
  migration (wallet stack is `@reown/appkit` + `@reown/appkit-adapter-wagmi` +
  `wagmi`).
- **Unused test/lint devDeps** — `fake-indexeddb` is required for the SSR
  indexedDB polyfill (`lib/wallet/polyfill-indexeddb.ts`), not for Jest.
  `@eslint/*` and `eslint-config-next` are wired in `eslint.config.mjs` (ESLint 9
  flat config — see §11). **Don't remove `fake-indexeddb`.**
- **Vitest** — configured; `npm test` runs the suite. Add pure `lib/` unit tests
  alongside the code as `*.test.ts`.
- **Unused exports** — a number of helpers are exported but not yet consumed
  (examples: `lib/constants.ts` time helpers, `lib/morpho/graphql-client.ts`
  types). They are kept as a shared vocabulary; remove individual ones only
  when you have a concrete reason. `filterDataByDate` was removed in favor of
  `filterDataByRange` (the superset).
- **Required peer deps pinned to fix build**:
  - `@swc/helpers` — required by Next.js client chunks under the webpack
    builder.
  - `@reduxjs/toolkit` + `react-redux` — required by `recharts` v3's
    Redux-backed state.
  Both are now listed in `package.json`.

If knip is re-run in the future, evaluate each flagged item individually; a
flag is a _signal_, not a mandate to delete.

---

## 16. Theme & Visual Density

### 16.1 Themes

The app supports three themes: `light`, `dark`, and `system` (follows OS).
They live in `lib/theme/ThemeContext.tsx` and are switched by
`components/ThemeSwitcher.tsx`.

A previous `y2k` theme was removed. `ThemeContext.getStored()` still recognizes
the legacy `'y2k'` value in `localStorage` and silently migrates those users to
`'system'`. The migration list (`LEGACY_THEMES`) is the place to add any
future retired themes.

### 16.2 Global compactness

The density that used to be scoped to the Y2K theme is now applied to every
theme through global CSS in `app/globals.css`:

- `html { font-size: 13.5px }` — intentionally smaller than shadcn's default
  16px, intentionally larger than the old Y2K `12.5px`. Tweak this single
  value before touching individual component paddings.
- `body { line-height: 1.45 }` — tighter than 1.5 so tables and lists pack
  more rows per viewport.
- `[data-slot='card-*']`, `[data-slot='table-*']`, `[data-slot='button']`,
  `[data-slot='input']`, `[data-slot='badge']`, `[data-slot='tabs-*']`,
  sidebar, and topbar selectors override shadcn defaults for tighter padding
  and smaller font sizes, across light/dark/system.

Rules:

- **Do not add a new theme to achieve compactness.** Adjust the global
  selectors instead so all themes stay consistent.
- **Do not inline `text-xs`/`p-2` on shadcn primitives** if the adjustment
  belongs on every instance — put it in the `[data-slot='...']` rule.
- When a component genuinely needs more breathing room (e.g. a chart tooltip
  or a modal header), add a local class rather than weakening the globals.

### 16.3 Chart filters

Dashboard charts (`ChartTvl`, `ChartInflows`, `ChartRevenue`, `ChartFees`)
expose at most two filter dropdowns:

- `TimeRangeFilter` — `All Time / 90D / 30D / 7D` (shared `TIME_RANGE_OPTIONS`
  in `lib/utils/date-filter.ts`; used on dashboard charts and vault history).
- `ViewModeFilter` — `Cumulative / Daily` (single button). Used by
  `ChartInflows`, `ChartRevenue`, `ChartFees` where daily-vs-cumulative is
  meaningful.
- `SourceModeFilter` — `Total / By Vault` (single button). Used by
  `ChartTvl` when both `totalData` and `vaultData` are supplied; gates the
  TVL chart between the aggregate line and per-vault breakdown lines.

All three follow the same pattern: a small outline button with an icon, a
label, and a `ChevronDown`, opening a popover of options. Keep it consistent
— don't regress to a row of inline buttons; it breaks the header density
we're aiming for.

### 16.4 Holders & transactions pagination

Both `components/morpho/VaultHolders.tsx` and
`components/morpho/VaultTransactions.tsx` paginate locally at **10 rows per
page**, with `ChevronLeft` / `ChevronRight` controls and a `Showing X–Y of Z`
label. Page state resets to 1 when the user changes a filter (e.g. the
deposit/withdraw toggle in `VaultTransactions`) so they're never stranded on
an empty tail page. Fetch limits remain generous so the UI sees a deep
history:

- `/api/vaults/[id]/holders` defaults to `first=100`, caps at `1000`. The V1
  GraphQL query also returns `vaultByAddress.asset { symbol, decimals }` so
  the UI can format share → asset amounts with the correct decimals (the fix
  for the previous "0.000" display on V1 vaults with 6-decimal USDC).
- `useVaultHolders` defaults to `first=500`.
- `VaultHolders` accepts `assetDecimals` / `assetSymbol` props as a fallback
  when the API doesn't supply them.
- `VaultTransactions` defaults to `limit=100`.

When adding new paginated tables, reuse the same 10/page pattern and the
`ChevronLeft`/`ChevronRight` control set for visual consistency.

---

## 17. Tests

**Vitest** is configured: `npm test` runs `vitest run`. Before pushing
substantive changes, run `npm test`, `npm run lint`, and `npm run build`.

Tests live next to the code as `lib/**/*.test.ts` (not under `__tests__/`), and
cover pure logic only. Do not call wagmi hooks from tests; mock React Query
hooks at module level. Tests must never hit the network — the Safe token tests
assert declared decimals are *plausible*, and on-chain agreement is verified
out of band, not in CI.

Existing suites worth extending: `lib/utils/rate-limit.test.ts` (client-IP trust
rules — the regression guard for the login bypass), `lib/safe/*.test.ts`
(transfer calldata, token registry, calldata preview decoding),
`lib/config/vaults.test.ts`, `lib/morpho/treasury-statement.test.ts`.

Also covered: `lib/safe/multisend.test.ts` (DelegateCall hazards, MultiSend
decode), `lib/safe/pending-store.test.ts` (import signature merge),
`lib/safe/address-book.test.ts`, `lib/morpho/morpho-app-links.test.ts`
(return-path open redirect), `lib/morpho/cap-decrease-input.test.ts`,
`lib/onchain/v2-rebalance-plan.test.ts` (idle re-anchor, % rounding),
`lib/bots/decode-transaction-vault-calls.test.ts` (Safe `execTransaction`
unwrap), `lib/utils/csv.test.ts`, `lib/utils/error-handler.test.ts`,
`lib/api/query-params.test.ts`.

Still uncovered and high value: `lib/morpho/tx-preview.ts`,
`lib/onchain/allocation-dust.ts` (`applyPlanningDust`).

---

## 18. Create Morpho Blue Market

Create-market UI was removed from this dashboard. Use
[muscadine-onchain](https://github.com/Muscadine-Labs/muscadine-onchain):

```bash
npx tsx src/cli.ts blue create-market --loan 0x… --collateral 0x… --oracle 0x… --irm 0x… --lltv …
npx tsx src/cli.ts blue dead-deposit --market 0x… --approve
```

Or Morpho’s curator UI: https://curator.morpho.org/markets/create

Hub still links those Morpho pages (`app/curator/page.tsx`). Markets browse stays
at `/markets`. Old `/markets/create` and `/markets/positions` redirect to `/markets`.

---

_Last updated: 2026-09-25. When you change reallocation logic, allocation
list/filters (§5), caps/adapters display, V2 idData/Sentinel (§3.2, §4.2), tx
preview, client fetch/cache (§4.3), app/API route paths (§2, §4.7, `next.config.ts`
redirects), Morpho GraphQL field names (§4.4.1), Curator markets browser (§4.7),
vault list/sidebar (§4.3.1), vault overview/history (share price in §4.4), risk scoring (§4.5), V2 idle/Blue/fee-wrapper display (§3.2.1), pending/emergency
tabs, wallet stack, Multisig Safe (§13), formatting, CCTP status (§14 removed), global
density (§16), brain/MCP (`docs/brain/`), or add a new vault interaction, update Sections 3–6, 4.2–4.7, 9–10,
13–14, 16–18 accordingly, and append `docs/brain/CHANGELOG.md`._
