# CLAUDE.md — Curator App Architecture & Vault Mechanics

This document is the canonical reference for AI assistants (and humans) working in
this repository. It captures the structure of the app, how Morpho V1 and V2 vaults
work, the subtle on-chain rules that caused real reallocation bugs in the past, and
the conventions the code follows today. Keep it up to date whenever you change
vault mechanics, contract wiring, or the data flow.

---

## 0. Working Agreements (read first)

- **Review `TODO.md` at the start of every session.** It is the running task list
 for the repo. Work the "TO work on today" section top-to-bottom unless the user
 directs otherwise; leave "To work on another day" items alone unless asked.
- **Version bump on every push to GitHub:** increment `package.json` `version` by
 0.0.1 per push. When the last digit would pass 9, roll it over to the next
 decimal (0.2.9 → 0.3.0, 1.9.9 → 2.0.0).
- **Before pushing:** run `npm run lint`, `npm test`, and `npm run build` and make
 sure all pass.

---

## 1. Project Overview

**Curator** is a Next.js (App Router) + TypeScript + Tailwind dashboard used by
Muscadine for managing and reporting on Morpho-style vaults on Base (chainId
`8453`). It covers:

- Vault overview, TVL, revenue and fee charts
- Per-vault pages for **Morpho V1 (MetaMorpho)** and **Morpho V2** with risk,
  governance, caps, queues, and allocation management
- Monthly statements (via DefiLlama and Morpho GraphQL)
- Curator tools (EIP-7702 delegation, Safe, frontend, morpho)
- Google Sheets integration for reporting

### Tech stack

- **Framework**: Next.js App Router (`app/`)
- **Language**: TypeScript (strict)
- **Styling**: Tailwind CSS + shadcn-style components in `components/ui/*`
- **Data**: React Query (`@tanstack/react-query`) for client caches
- **Wallet UI**: `@rainbow-me/rainbowkit` + `wagmi` (`getDefaultConfig` in
  `lib/wallet/config.ts`, `RainbowKitProvider` in `app/providers.tsx`,
  `ConnectButton` in topbar). Connect modal wallets (in order): **Rabby,
  MetaMask, Base, Phantom, WalletConnect** — no server-side private keys for
  vault writes.
- **GraphQL**: Morpho Blue API (`https://api.morpho.org/graphql`) via
  `graphql-request` in `lib/morpho/graphql-client.ts`. **Vault list, detail,
  history, risk, and protocol stats BFF routes use this client directly** — not
  the Morpho SDK runtime.
- **Onchain SDK**: `@morpho-org/blue-sdk`, `@morpho-org/blue-api-sdk`,
  `@morpho-org/morpho-ts` — used mainly for **TypeScript types** (e.g. markets
  ratings in `lib/morpho/service.ts`). Typed vault writes use ABIs in
  `lib/onchain/abis.ts` + `vault-writes.ts`, not `@morpho-org/morpho-sdk-v2`.
- **Auth**: Custom curator auth (`lib/auth/*`) with signed session tokens

---

## 2. Repository Layout

```
app/
  api/                 Next.js route handlers (BFF for Morpho + onchain data)
    vaults/            GET /api/vaults, /api/vaults/[id]
    vaults/v1/[id]/    V1-specific endpoints (market-risk)
    vaults/v2/[id]/    V2-specific endpoints (risk, governance)
    morpho-markets/    Cross-vault market list
    protocol-stats/    Aggregate TVL / revenue
    monthly-statement-* Statement generators
    google-sheets/     Sheets export
    auth/              Session verify
  curator/             Curator-only tools (eip-7702, safe, frontend, morpho)
  overview/            Aggregate dashboards
  vault/v1/[address]/  V1 vault detail page
  vault/v2/[address]/  V2 vault detail page
  vaults/              Vault list & legacy details

components/
  morpho/              Vault-specific UI (AllocationV1, VaultV2Allocations,
                       VaultV2Caps, VaultRiskV1/V2, ...)
  layout/              AppShell, Sidebar, Topbar
  ui/                  Primitive components (button, card, input, table, ...)
  eip7702/             EIP-7702 delegation control

lib/
  auth/                Curator auth context + server helpers
  config/vaults.ts     Tracked vault addresses (V1 + V2)
  format/number.ts     Central number/BigInt formatting helpers
  hooks/               React Query hooks for vault data (markets, caps,
                       queues, risk, roles, governance, writes)
  morpho/              Morpho GraphQL queries, compute helpers, IRM/oracle math
  onchain/
    abis.ts            MetaMorpho V1 + Vault V2 ABIs
    client.ts          viem client factory
    contracts.ts       Chain/address constants
    vault-writes.ts    Typed write config builders (reallocate, allocate,
                       deallocate, caps, multicall, ...)
  theme/               Theme context
  utils/               Logger, rate limit, env validation, error handler
  wallet/              Wagmi + RainbowKit config (`getDefaultConfig`), indexeddb polyfill

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

### 3.1 Morpho V1 (MetaMorpho) — **target-based `reallocate`**

- Contract: `MetaMorpho` (`lib/onchain/abis.ts: metaMorphoV1Abi`)
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
  - The pure helper that enforces this lives in `lib/onchain/reallocation.ts`
    (`buildV1ReallocationPlan`). `AllocationV1.tsx` calls it instead of
    duplicating the logic, and `lib/onchain/__tests__/reallocation.test.ts`
    asserts the catcher is always present whenever the plan contains at
    least one withdrawal.
  - We do this in `components/morpho/AllocationV1.tsx` by sorting deposits by
    positive delta and tagging the **largest** as the catcher.
- **Cap model**: each market has a `supplyCap` (absolute assets). We validate
  targets against `supplyCap` client-side before sending the tx.

### 3.2 Morpho V2 — **delta-based `allocate` / `deallocate`**

- Contract: Vault V2 (`lib/onchain/abis.ts: vaultV2Abi`)
- Write entrypoints (per adapter):
  - `allocate(address adapter, bytes idData, uint256 assets, uint256 maxAssets)`
  - `deallocate(address adapter, bytes idData, uint256 assets, uint256 minAssets)`
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
- **Cap data source**: `useVaultV2Governance` (`/api/vaults/v2/[id]/governance`),
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
  | MetaMorpho allocate/deallocate `data` | `METAMORPHO_ADAPTER_DATA` | `0x` (empty bytes) |

  Use `resolveCapIdData(cap, risk)` for `decreaseAbsoluteCap` /
  `decreaseRelativeCap`. Market caps need `cap.adapterAddress` from governance
  GraphQL plus full market params from the risk API (oracle, irm, lltv, token
  addresses). Wrong encoding causes silent cap lookup misses or on-chain reverts.
  Reference: [Morpho market listing docs](https://docs.morpho.org/curate/tutorials-v2/market-listing/).
- **No max-catcher needed** — V2 is delta-based so interest drift doesn't cause
  a balancing revert; the allocator simply chooses deltas.
- **Idle (vault cash)** — V2 holds unallocated assets in the vault contract
  (`idleAssets` / `idleAssetsUsd` from Morpho GraphQL). This is **not** a
  strategy adapter contract, but the UI treats it as a first-class rebalance
  target alongside `MetaMorphoAdapter` and `MorphoMarketV1Adapter` rows:
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
    **Idle** via deallocations. Auto-dust (`applyPlanningDust`) only runs in
    **full % rebalance** (every row edited) and only nudges **Idle** for
    sub-token rounding. The curator can **explicitly** route the remainder to a
    strategy target via `DustRecipientSelect` (default `auto` = Idle); the
    explicit recipient still goes through cap validation before submit.
  - **Delisted targets**: a strategy row with **zero allocation and no active
    cap** (absolute and relative both absent/zero, with governance caps loaded)
    is hidden from the Allocations list — the vault can no longer allocate to
    it (e.g. a deallocated + delisted Blue market that Morpho's own UI no
    longer shows). Zero-allocation rows with a live cap stay visible. Same rule
    on V1: zero allocation + supply cap exactly 0 is hidden (`null` cap =
    unknown, kept; `parseSupplyCap` preserves explicit `0`).
  - **Risk tab** (`VaultRiskV2.tsx`): idle counts toward **Adapters Count**
    (`strategy adapters + 1`) and appears as its own row (“No strategy risk”).

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

### 4.1 V1 (`app/vault/v1/[address]/page.tsx`)

1. `useVaultV1Complete` fans out to:
   - `useVault(address)` → `/api/vaults/[id]` → Morpho GraphQL. Provides
     `allocation[]` with `market`, `assets`, `supplyAssets`, `supplyCap`, etc.
   - `useVaultV1MarketRisk` → per-market risk
   - `useVaultCaps`, `useVaultQueues`, `useVaultRoles` (governance detail)
2. `components/morpho/AllocationV1.tsx` receives the preloaded vault and risk.
   It builds market rows, then on submit calls `v1WriteConfigs.reallocate(...)`
   via `useVaultWrite`. UI uses the shared **list layout**
   (`AllocationListView.tsx`): two-column “Allocation” header, sections **Idle**
   then **Morpho Blue Market**, optional metric columns from filters, LLTV
   pills on Blue rows (`86%` style via `formatLltvPill`).
3. Number display uses `lib/format/number.ts` helpers
   (`formatRawTokenAmount`, `formatFullUSD`) for precision output.

### 4.2 V2 (`app/vault/v2/[address]/page.tsx`)

**Tab order** (matches Morpho Curator; no standalone Risk tab in the nav):
Overview → Roles → Adapters → Caps → Timelocks → Allocation → Sentinel → Emergency.

1. `useVaultV2Complete` fans out to:
   - `useVault(address)` for base data
   - `useVaultV2Risk` → `/api/vaults/v2/[id]/risk` (adapters, markets, idle)
   - `useVaultV2Governance` → `/api/vaults/v2/[id]/governance` (caps, roles,
     timelocks, `idleAssets`)
   - `useVaultV2Pending`
2. **Roles** — `VaultV2Roles.tsx` (read-only): owner, curator, allocators,
   sentinels.
3. **Adapters** — `VaultV2Adapters.tsx` lists the idle adapter first, then
   registered strategy adapters from governance. Pass `assetSymbol` /
   `assetDecimals` from the vault page for token formatting.
4. **Caps** — `VaultV2Caps.tsx`. Grouped adapter / collateral / market cap
   tables (read-only). Embeds `VaultV2Pending` when `pending.length > 0`.
   Tab label shows pending count. Pass `assetSymbol` / `assetDecimals` from
   the vault page. Display **absolute cap** and **allocation** with
   `formatRawTokenAmount` (not raw uint256).
5. **Timelocks** — `VaultV2Timelocks.tsx` (read-only).
6. **Allocation** — `VaultV2Allocations.tsx` receives `preloadedData`
   (governance) **and** `preloadedRisk`. Caps are resolved via
   `keccak256(idData)` using helpers in `lib/morpho/v2-id-data.ts` (see §3.2).
   **List layout** (same shell as V1):
   sections in order **Idle → V1 Vault → Morpho Blue Market** (MetaMorpho rows
   show a **V1**/**V2** pill from `VAULT_VERSION_MAP` on the underlying vault
   address). No per-row type labels (section headers carry context). No token
   icons. Row types:
   - **MetaMorphoAdapter** — one row per wrapped V1/V2 vault (not per underlying
     Blue market). Pair label uses `formatMarketPairLabel` (`cbBTC / USDC`).
     Metrics from `underlyingVaultStats` on the risk API.
   - **MorphoMarketV1Adapter** — one row per Blue market position. LLTV pill
     next to name. Utilization, borrow/supply APY, liquidity from `market.state`.
     APY/utilization GraphQL values are **decimals**; multiply by 100 before
     `formatPercentage`.
   - **Idle** — vault cash row; no on-chain cap; no direct writes.
7. **Sentinel** — `VaultV2Sentinel.tsx` (Morpho Curator–style; **only tab with
   sentinel writes**). Sections:
   - **Allocation Overview** — stacked bar + per-target token amounts and `%`.
   - **Vault Pending Actions** — read-only; empty state “No pending actions”.
   - **Decrease Caps** — adapter / collateral / market tables; radio pick
     absolute vs relative per row; new value input; single **Decrease Caps**
     button (multicall when multiple). Uses `resolveCapIdData` + `parseHumanTokenInput`.
     New cap must be **≤ current** cap. `TransactionButton` uses
     `suppressConnectPrompt` (wallet connect is in the topbar only).
   - **Deallocate to Idle** — table (Idle row display-only) with amount + Max
     per strategy row; batch **Deallocate** via `encodeMarketParamsData` or
     `METAMORPHO_ADAPTER_DATA`. Token parse via `parseHumanTokenInput`.
8. **Emergency tab** — links to Morpho Curator emergency actions:
   `https://curator.morpho.org/vaults/{chainId}/{vaultAddress}/emergency-actions`
9. Submits use `v2WriteConfigs.allocate/deallocate` wrapped in
   `v2WriteConfigs.multicall` when multiple moves are planned.

`VaultRiskV2.tsx` remains in the codebase for reference but is **not** a main
vault tab. V1 vault pages use a separate tab set (see V1 route if present).

### 4.3 Caching

All GET-style API routes return JSON consumed by React Query. Query keys:

- `['vault', address]`
- `['vault-history', address]`
- `['vault-v1-market-risk', address]`
- `['vault-v2-risk', address]`
- `['vault-v2-governance', address]`
- `['vault-v2-pending', address]`
- `['vault-v1-pending', address]`
- `['vault-v1-parameters', address]`, `['vault-v2-parameters', address]`
- `['vault-caps', address]`, `['vault-queues', address]`, `['vault-roles', address]`
- `['markets']`, `['morpho-markets']`, `['protocol-stats']`

Hooks live in `lib/hooks/` and should be the only entry points for reading
vault data from components.

### 4.3.1 Vault list API and sidebar

`GET /api/vaults` (`app/api/vaults/route.ts`) fans out V1 (`vaults { … }`) and
per-address V2 (`vaultV2ByAddress`) Morpho GraphQL queries. Each row is enriched
from `lib/config/vaults.ts` with:

- `id` — same as vault `address` (for legacy UI keys)
- `version` — `v1` | `v2` from config `morphoVersion`
- `listCategory` — optional `prime` | `vineyard` | `v1` | `test`

`?includeAll=true` includes test vaults (`excludeFromBusinessViews`); default list
is business vaults only.

**Sidebar** (`components/layout/Sidebar.tsx`) uses `useVaultList({ includeAll: true })`.
Section order under each network (Base only today): **V2 Prime → V1 Vaults → V2
Vineyard → V2 Test**. Categorization prefers `version` / `listCategory` from the
API, then `getVaultCategory(name, address)` heuristics. V1 routes:
`/vault/v1/{address}`; V2 Prime/Vineyard/Test use `/vault/v2/{address}`.

Ethereum appears in `SIDEBAR_NETWORKS` but has no configured vaults — expand
**Base**, not Ethereum, to see vault links.

### 4.4 Vault overview, liquidity, and history (Morpho GraphQL)

**Overview** — `VaultOverviewPanel` + `GET /api/vaults/[id]` (`app/api/vaults/[id]/route.ts`).

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
  timeseries). Spot withdrawable liquidity stays on the overview breakdown card.
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
| `uniqueKey` on `Market` | `marketId` | All market GraphQL selections; keep `marketKey` in JSON for UI |
| `VaultState.avgApy`, `monthlyNetApy`, `weeklyNetApy`, `dailyApy`, `netApyWithoutRewards`, … | Removed — use `apy`, `netApy`, `avgNetApy`, `netApyExcludingRewards` | V1 detail + list |
| V2 spot `avgApy` on vault | Use `apy`, `avgNetApy`, `maxApy` | V2 detail + list |

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
  for `MorphoMarketV1Adapter` rows; for **MetaMorpho** rows = underlying V1 vault
  withdrawable liquidity (`liquidity.usd` / `liquidity.underlying` via
  `underlyingVaultStats`). Not vault-level V2 withdrawable liquidity.
- V2 risk API (`/api/vaults/v2/[id]/risk`) exposes `idleAssets`, `idleAssetsUsd`,
  and `underlyingVaultStats` on MetaMorpho adapters. Underlying stats are loaded
  via `lib/morpho/query-v1-vault-markets.ts` (`vaultStats`: `netApy`, `totalAssets`,
  `totalAssetsUsd`, `liquidityUsd`, `liquidityUnderlying`).

### 4.5 Risk management scoring (V1 & V2)

Both vault versions score **Morpho Blue markets** with the same pure function:
`lib/morpho/compute-v1-market-risk.ts` → `computeV1MarketRiskScores`. V1 and V2
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
| `oracleScore ≤ 20` (missing/opaque oracle) | composite ≤ 54 (C+ max) |
| `utilizationScore ≤ 20` (very high util) | composite ≤ 60 (B− max) |
| `coverageRatioScore < 100` (cannot fully cover shock liquidations) | composite ≤ 68 (B max) |

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

**Letter grades** (`getMarketRiskGrade` / `getGradeFromScore`): A+ ≥93, A ≥90, A− ≥87,
B+ ≥84, B ≥80, B− ≥77, C+ ≥74, C ≥70, C− ≥65, D ≥60, F &lt;60.

**External links** — `lib/morpho/morpho-app-links.ts`:
- Blue market → `morphoMarketHref(marketId)` (param name `uniqueKey` in code) →
  `app.morpho.org/base/market/…`
- Wrapped V1 vault → `morphoVaultHref(address)` → `app.morpho.org/base/vault/…`
  Used in `MarketRiskDetailCard`, `VaultRiskV2` (MetaMorpho title), and allocation tables.

#### V1 vault risk

| Layer | Where | Aggregation |
| ----- | ----- | ------------- |
| Market | `GET /api/vaults/v1/[id]/market-risk` | `computeV1MarketRiskScores` per non-idle market |
| Vault headline | `VaultRiskV1.tsx` (client) | USD-weighted avg of market scores |

**API** (`market-risk/route.ts`): `fetchV1VaultMarkets` → parallel oracle + IRM
target fetch → scores per market. Response: `{ markets[], vaultLiquidity }` (no
pre-aggregated vault score).

**Vault score (UI):** for each market, weight by `vaultSupplyAssetsUsd`. Sum
`marketRiskScore × supplyUsd` for **non-idle markets with scores**; divide by
**total** `vaultSupplyAssetsUsd` (including idle allocation). Idle therefore
**dilutes** the vault headline toward 0 when a large cash buffer is unallocated.

**UI:** `VaultRiskV1` — vault KPI card + liquidity vs TVL;
`MarketRiskV1` — per-market `MarketRiskDetailCard` with component breakdown.

#### V2 vault risk

| Layer | Where | Aggregation |
| ----- | ----- | ------------- |
| Market | `buildMarketRisk` in `risk/route.ts` | Same `computeV1MarketRiskScores` |
| Adapter | `computeAdapterRisk` | USD-weighted avg of market scores in adapter |
| Vault headline | `risk/route.ts` response | USD-weighted avg of **strategy adapter** scores |

**MorphoMarketV1Adapter:** GraphQL positions → one `buildMarketRisk` per position;
adapter score = `computeWeightedRisk` over non-idle markets with `allocationUsd > 0`.
API returns nested `markets[]` for per-market cards in `VaultRiskV2`.

**MetaMorphoAdapter:** `fetchV1VaultMarkets(underlyingVaultAddress)` loads underlying
Blue markets; adapter score = same USD-weighted market average as if it were a V1
vault. API sets **`markets: []`** — V2 risk UI shows **vault-level score only**
(no nested Blue rows). `underlyingVaultStats` supplies net APY, TVL, and withdrawable
liquidity for the wrapped vault. Title links to Morpho app + “View in Curator →”
(`/vault/v1/{address}`).

**Vault score (API):** `vaultRiskScore = Σ(adapter.riskScore × adapter.allocationUsd) /
totalAdapterAssetsUsd` where `totalAdapterAssetsUsd` sums **strategy adapters only**.
**Idle is excluded** from vault score numerator and denominator (UI shows idle as
its own row with “No strategy risk”; it does not dilute or improve the headline).

**Idle row (UI only):** `VaultRiskV2` renders idle from `idleAssets` / `idleAssetsUsd`.
Adapter count KPI = `adapters.length + 1`. Total allocated display =
`totalAdapterAssetsUsd + idleAssetsUsd`.

**Hooks / cache:** `useVaultV1MarketRisk`, `useVaultV2Risk`; keys
`['vault-v1-market-risk', address]`, `['vault-v2-risk', address]`. Routes cache
`public, s-maxage=120, stale-while-revalidate=300`.

#### Do not regress

- Reuse `computeV1MarketRiskScores`; do not fork component weights in UI.
- Utilization: **100 at/below IRM target**, not “lower util = safer”.
- V2 MetaMorpho: do not list underlying Blue markets in risk UI (`markets: []` by design).
- V1 vault score divides by total supply **including idle**; V2 vault score **excludes idle**.
- GraphQL APY/utilization on the risk route are **fractions (0–1)**; multiply by 100
  before `formatPercentage` in allocation/risk UI.

### 4.6 Monthly income statement (treasury wallet)

**UI** — `app/overview/monthly-statement/page.tsx` (tabs: **By Treasury Wallet** /
**DefiLlama**). Treasury view modes: **By Revenue** (default — From Vaults vs
Miscellaneous Income), Total, By Token, By Vault. Dashboard overview can toggle
the same treasury source via `lib/RevenueSourceContext.tsx` (default: treasury).

**Treasury API** — `GET /api/monthly-statement-morphoql`
(`lib/morpho/treasury-statement.ts` + route handler).

| Field | Meaning |
| ----- | ------- |
| `assets` / `total` | Net **positive** growth in treasury vault share balances (month-over-month) |
| `miscellaneous` | Capital **deposits + incoming share transfers** into treasury positions (tx-indexed) |
| `vaultFees` | `assets − miscellaneous` — performance fee accrual / residual growth not explained by capital inflows |

**Treasury wallet:** `TREASURY_ADDRESS` in `lib/morpho/treasury-statement.ts`
(`0x057f…266A`, Base Safe). **Vaults:** six business vaults from
`getVaultAddressesForBusinessViews()`. **Start date:** `2025-11-01`.

**Gross revenue (position-based):** For each vault position, compare share `assets`
at end of previous month vs end of current month. Only **positive** token deltas count.
USD uses end-of-period price on **new tokens only** (same as before).

**Miscellaneous (transaction-based):** Morpho GraphQL tx index, **not** position deltas.

| Vault | Included tx types | Rule |
| ----- | ----------------- | ---- |
| V1 | `vaultV1Transactions` — `Deposit`, `Transfer` | Deposit: `onBehalf` = treasury; Transfer: `to` = treasury (`assets` on tx root) |
| V2 | `vaultV2transactions` — `Deposit`, `Transfer` | Same as V1 (`VaultV2DepositData` / `VaultV2TransferData`) |

Do **not** use legacy `transactions` + `MetaMorphoDeposit` for V1 — it indexes fee events under
`userAddress_in` and misses share transfers into the treasury. Use `vaultV1Transactions` with
`type_in: [Deposit, Transfer]`, `timestamp_gte`, and **cursor** pagination (`endCursor` →
`txHash` + `logIndex`). V1 does **not** support `skip`.

Explicitly **excluded** from miscellaneous: `MetaMorphoFee` (V1), withdrawals, outgoing
transfers. V2 fee accrual has no dedicated tx type — it remains in `vaultFees` as the
residual after subtracting misc from position growth.

**DefiLlama tab** — `GET /api/monthly-statement-defillama` (protocol-level fees/revenue;
unrelated to treasury wallet deposits).

**Do not regress:** Do not treat treasury **deposits/transfers in** as vault performance
fees. When changing statement logic, keep `vaultFees + miscellaneous ≈ total` per month.

---

## 5. Reallocation UX Conventions (current code)

These rules are baked into `AllocationV1.tsx`, `VaultV2Allocations.tsx`,
`AllocationListView.tsx`, and `AllocationFilters.tsx` — preserve them:

### 5.1 List layout (`AllocationListView.tsx`)

- Morpho-style card: header **Allocation | Allocation** (name left, amount right).
- **Sections** (fixed order on V2): Idle → V1 Vault → Morpho Blue Market.
  V1 uses Idle → Morpho Blue Market. Section headers replace per-row type labels.
- **No token icons.** LLTV on Blue rows is a gray pill (`86%`) via
  `formatLltvPill`, not “LLTV 86%”.
- Optional metric columns render as compact extra cells when enabled in filters.
- Edit mode adds a **New** column for target inputs.

### 5.2 Filters (`AllocationFilters.tsx`)

- Single popover for search, idle toggles, sort, **amount unit** (USD / Tokens),
  display mode (amount / percent), and optional columns.
- **Do not** add a separate `UsdTokenModeFilter` on allocation pages — amount
  unit lives only in Filters.
- **Default optional columns ON:** utilization, liquidity, supply APY, allocated.
- **Default optional columns OFF:** borrow APY, effective cap, percent cap.
- Column keys: `effectiveCap` (absolute token cap) and `percentCap` (relative
  WAD on V2; supply cap as % of vault on V1). Replaced the old single `cap` key.

### 5.3 Planning & submit

1. **Edit inputs are human-readable strings** parsed with `parseUnits` /
   percentage of `totalRawAssets`.
2. **Cap validation** runs client-side before enabling submit.
   - V1: `target <= supplyCap` per market
   - V2: `target <= absoluteCap` and relative cap vs `firstTotalAssets`
3. **Remaining banner** (`RemainingBanner`):
   - **Planned** = `inputSum` (sum of resolved target inputs), **not** forced to
     `totalRawAssets` after dust adjustment.
   - V2 under-allocation: “X will move to Idle after rebalance” (`implicitIdle`).
   - Uses `formatRawTokenAmount` for token amounts.
4. **V1 submit** uses `maxUint256` on the chosen dust recipient's deposit when
   the plan includes withdrawals. `DustRecipientSelect` lets the curator pick
   the catcher row (default: largest target).
5. **V2 submit** batches via `multicall`; deallocates before allocates.
   `DustRecipientSelect` (auto = **Idle**) lets the curator explicitly route the
   unallocated remainder to a strategy target; with `auto` the remainder is
   implicit Idle. Never **auto**-inflate a strategy target to absorb
   under-allocation — only an explicit curator choice may do so, and it still
   passes cap validation.
6. **V2 idle row** — editable for planning; never in `allocate`/`deallocate`
   calldata.
7. Use `formatRawTokenAmount` for all raw bigint display (avoid `1.23e-6`).
8. **APY / utilization from Morpho GraphQL** (V2 risk route): multiply by 100
   before `formatPercentage`. V1 vault API pre-scales allocation fields.

### 5.4 Adapters & caps tabs

- **Adapters** (`VaultV2Adapters.tsx`): idle row first, then strategy adapters.
  **Allocated** shows decimal token amount + symbol only — no USD line, no
  “Raw: … units”. Pass `assetSymbol` / `assetDecimals` from the vault page.
- **Caps** (`VaultV2Caps.tsx`): absolute cap and allocation use
  `formatRawTokenAmount` with vault asset decimals. Relative cap stays as %.
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

`lib/onchain/vault-writes.ts` defines typed write config builders:

- V1: `v1WriteConfigs.reallocate(vaultAddress, MarketAllocation[])`
- V2:
  - `v2WriteConfigs.allocate(vaultAddress, adapter, idData, assets, maxAssets)`
  - `v2WriteConfigs.deallocate(vaultAddress, adapter, idData, assets, minAssets)`
  - `v2WriteConfigs.multicall(vaultAddress, calls)`
  - `v2WriteConfigs.increase/decreaseAbsoluteCap`, relative cap variants

`lib/hooks/useVaultWrite.ts` wraps `wagmi`'s write hooks to expose
`{ write, isPending, isSuccess, error, txHash }`. Always pass a fully-built
config object produced by the helpers above — do **not** hand-roll ABIs in
components.

---

## 8. Error Handling & Observability

- `lib/utils/logger.ts` is the structured logger used by API routes.
- `lib/utils/error-handler.ts` normalizes errors into `{ error, message }` JSON.
- `components/ErrorBoundary.tsx` catches render errors.
- For reallocation failures, surface:
  - Cap validation messages inline next to inputs
  - A top-level alert containing the revert reason (use `error.shortMessage`
    from viem when available)
- When adding new write flows, always add a UI path for the `error` state.

---

## 9. Auth & Gating

- Curator-only routes live under `app/curator/*` and use `AuthGuard`.
- Server auth verification lives in `app/api/auth/verify/route.ts` and
 `lib/auth/curator-auth.ts`. The **only** username is **`admin`**
 (case-sensitive, role `'admin'`); password from env `CURATOR_ADMIN_PASSWORD`
 (legacy `CURATOR_OWNER_PASSWORD` still accepted as fallback; must be
 uncommented in `.env.local`; server restart required after changes).
- Write UI (reallocate, caps, etc.) is gated on both wallet connection and
  curator role.
- **All on-chain writes** (V1/V2 reallocate, caps, CCTP, etc.) go through
  **RainbowKit → connected wallet** (`useVaultWrite` / wagmi `writeContract`).
  Do not add server-side private keys for allocation flows.
- Wallet connect lives in the **topbar** (`ConnectWalletButton` / RainbowKit
  `ConnectButton`). Recommended wallets are configured in
  `lib/wallet/config.ts` (`wallets` array on `getDefaultConfig`). Chain
  switching is in the RainbowKit account modal.

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
- Deallocate Blue markets: `data = encodeMarketParamsData(market)`. MetaMorpho:
  `data = 0x`.
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
  MetaMorpho ↔ idle moves are unaffected.

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

### V2 MetaMorpho row missing supply APY / TVL / liquidity

- Extend `fetchV1VaultMarkets` / risk route `underlyingVaultStats`, not the
  allocations component alone. Needs `state { totalAssets, netApy }` and
  `liquidity { usd, underlying }` on the underlying V1 vault query.

### V2 adapter count wrong in Risk

- Count is **strategy adapters + 1** (idle). Idle is not returned in
  `adapters.items` from GraphQL but must be included in the KPI.

### Risk score looks wrong after utilization/oracle changes

- Per-market math lives only in `lib/morpho/compute-v1-market-risk.ts`. Utilization
  uses `scoreUtilizationRatio`: optimal at IRM target (~90%), not “lower is safer”.
- V1 vault headline **dilutes** with idle allocation (idle in denominator, not numerator).
- V2 vault headline **ignores idle** entirely; only strategy adapter allocations weight
  `vaultRiskScore`.
- MetaMorpho adapter score weights underlying V1 markets but returns `markets: []` to
  the V2 risk UI — do not expect nested Blue cards there.
- Realized bad debt &gt; $1 forces market grade **F** / score **0**.

### Pending tab visible with nothing to accept

- V2: pending embeds in **Caps** tab (count in tab label); Sentinel shows a
  read-only pending section with empty state. No standalone Pending tab on V2.
- V1: hide the tab when `pending.length === 0`.

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
npm test               # jest
npm run build
```

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
| V1 allocation UI + reallocate    | `components/morpho/AllocationV1.tsx`                    |
| V2 allocation UI + allocate/etc. | `components/morpho/VaultV2Allocations.tsx`              |
| Allocation list shell + sections | `components/morpho/AllocationListView.tsx`               |
| V2 adapters UI (incl. idle)      | `components/morpho/VaultV2Adapters.tsx`                 |
| V2 caps UI (read-only + pending) | `components/morpho/VaultV2Caps.tsx`                      |
| V2 roles / timelocks UI          | `components/morpho/VaultV2Roles.tsx`, `VaultV2Timelocks.tsx` |
| V2 Sentinel UI + writes          | `components/morpho/VaultV2Sentinel.tsx`                  |
| V2 cap idData encoding           | `lib/morpho/v2-id-data.ts` (`resolveCapIdData`, …)       |
| V2 cap display helpers           | `lib/morpho/v2-cap-format.ts`                            |
| V2 risk UI (incl. idle count)    | `components/morpho/VaultRiskV2.tsx`, `MarketRiskDetailCard.tsx` |
| Market risk scoring (shared)     | `lib/morpho/compute-v1-market-risk.ts`, `lib/morpho/irm-utils.ts`, `lib/morpho/oracle-utils.ts` |
| Morpho app deep links            | `lib/morpho/morpho-app-links.ts`                         |
| V2 pending UI                    | `components/morpho/VaultV2Pending.tsx`                    |
| V1 pending UI                    | `components/morpho/VaultV1Pending.tsx`                    |
| V2 vault page (tabs)             | `app/vault/v2/[address]/page.tsx`                         |
| V1 vault page (tabs)             | `app/vault/v1/[address]/page.tsx`                         |
| Underlying V1 vault stats query  | `lib/morpho/query-v1-vault-markets.ts`                    |
| Wallet / RainbowKit config       | `lib/wallet/config.ts`, `app/providers.tsx`, `components/ConnectWalletButton.tsx` |
| Shared filters UI                | `components/morpho/AllocationFilters.tsx`               |
| Number formatting                | `lib/format/number.ts`                                   |
| ABIs                             | `lib/onchain/abis.ts`                                    |
| Write configs                    | `lib/onchain/vault-writes.ts`                            |
| V1 reallocation planner (pure)   | `lib/onchain/reallocation.ts`, `lib/onchain/allocation-dust.ts` |
| Dust recipient UI                | `components/morpho/DustRecipientSelect.tsx`              |
| Write hook                       | `lib/hooks/useVaultWrite.ts`                             |
| V1 data hook                     | `lib/hooks/useVaultV1Complete.ts`                        |
| V2 data hook                     | `lib/hooks/useVaultV2Complete.ts`                        |
| V2 caps API                      | `app/api/vaults/v2/[id]/governance/route.ts`             |
| Vault overview + history chart   | `components/morpho/VaultOverviewPanel.tsx`, `VaultOverviewHistoryChart.tsx` |
| Vault history BFF                | `app/api/vaults/[id]/history/route.ts`, `lib/morpho/vault-history.ts` |
| Treasury monthly statement       | `app/api/monthly-statement-morphoql/route.ts`, `lib/morpho/treasury-statement.ts`, `app/overview/monthly-statement/page.tsx` |
| Vault overview analytics         | `lib/morpho/vault-analytics.ts`                          |
| Chart metric / unit filters      | `components/charts/MetricModeFilter.tsx`, `UsdTokenModeFilter.tsx` |
| Asset decimals + allocation fmt  | `lib/format/asset-decimals.ts`, `allocation-display.ts` |
| V1 parameters API                | `app/api/vaults/v1/[id]/parameters/route.ts`             |
| V2 cap helpers                   | `lib/morpho/cap-utils.ts`, `lib/morpho/vault-v2-governance-map.ts` |
| V2 risk API                      | `app/api/vaults/v2/[id]/risk/route.ts`                   |
| V1 market risk API               | `app/api/vaults/v1/[id]/market-risk/route.ts`            |
| Vault list API                   | `app/api/vaults/route.ts`, `app/api/vaults/[id]/route.ts`|
| Vault history + share price      | `lib/morpho/vault-history.ts`, `useVaultHistory.ts`, `VaultOverviewHistoryChart.tsx` |
| Sidebar vault sections           | `components/layout/Sidebar.tsx`, `lib/config/vaults.ts` (`getVaultCategory`) |
| Market id helpers                | `lib/morpho/morpho-app-links.ts` (`marketKeyFromGraphQL`) |
| Vault addresses                  | `lib/config/vaults.ts`                                   |
| CCTP constants (chains/ABIs)     | `lib/cctp/constants.ts`                                  |
| CCTP attestation helper          | `lib/cctp/attestation.ts`                                |
| CCTP transfer page               | `app/curator/cctp/page.tsx`                              |
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

---

## 13. CCTP (Circle Cross-Chain Transfer) Page

`app/curator/cctp/page.tsx` provides a step-by-step USDC bridge using Circle's
**CCTP V2**. No third-party bridge, no wrapping. Supports Fast Transfer
(~seconds) and Standard Transfer (~minutes).

### 13.1 Architecture

| Aspect | CCTP V2 |
|---|---|
| Contracts | `TokenMessengerV2` + `MessageTransmitterV2` (same CREATE2 address on all EVM chains) |
| `depositForBurn` params | 7: `amount, destinationDomain, mintRecipient, burnToken, destinationCaller, maxFee, minFinalityThreshold` |
| Attestation | `GET /v2/messages/{sourceDomainId}?transactionHash={hash}` — returns message + attestation in one call |
| Transfer speed | Fast (`minFinalityThreshold=1000`, ~seconds) or Standard (`2000`, ~minutes) |
| Fees | Standard: gas only. Fast: variable fee via `/v2/burn/USDC/fees/{src}/{dst}` |

### 13.2 Supported chains

`lib/cctp/constants.ts :: CCTP_CHAINS` lists every chain. All EVM chains use
the same V2 CREATE2 contract addresses.

Enabled:
- Ethereum (0), Avalanche (1), Optimism (2), Arbitrum (3), Base (6), Polygon (7), HyperEVM (19)

Disabled:
- Solana (5) — non-EVM, requires Solana wallet

V2 contracts (same on every chain):
- `TokenMessengerV2`: `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d`
- `MessageTransmitterV2`: `0x81D40F21F12A8F0E3252Bccb954D722d4c464B64`

### 13.3 Flow

```
[User]            [Source chain]                   [Circle Iris API]      [Dest chain]
  │                     │                                │                    │
  │  1. approve USDC ──▶ TokenMessengerV2               │                    │
  │                     │                                │                    │
  │  2. depositForBurn ─▶ TokenMessengerV2              │                    │
  │     (7 params: + destinationCaller, maxFee,         │                    │
  │      minFinalityThreshold)                          │                    │
  │                     │                                │                    │
  │  3. GET /v2/messages/{domain}?txHash={hash} ────────▶                   │
  │                     │            poll q~3s (fast)    │                    │
  │                     │            or q~10s (standard) │                    │
  │                     │     returns { message, attestation }               │
  │                     │                                │                    │
  │  4. receiveMessage(message, attestation) ─────────────────────────────▶ MessageTransmitterV2
  │                                                                          │  mints USDC
```

### 13.4 UI features

- **Speed selector** — Fast (~seconds, may incur a fee) or Standard (~minutes,
  gas only).
- **Fee display** — queries the fee endpoint and shows the estimated fee for
  Fast Transfer.
- **Chain selector** — disabled chains show "(not supported)".
- **Persisted state** — `localStorage` saves speed + transfer state so it
  survives page refresh.

### 13.5 Key utilities

- `addressToBytes32(addr)` — 20-byte address → bytes32 `mintRecipient`.
- `fetchAttestationV2(sourceDomain, txHash)` — single-call message +
  attestation via `/v2/messages/{domain}?transactionHash={hash}`.
- `fetchTransferFee(srcDomain, dstDomain)` — fee estimate.

### 13.6 Notes when extending

- If Circle adds a new chain, add it to `CCTP_CHAINS` with
  `tokenMessenger` and `messageTransmitter` addresses **and** to
  `lib/wallet/config.ts` (chains + transports).
- `depositForBurnWithHook` (V2 hooks feature) isn't wired up yet. The current
  implementation passes empty `destinationCaller` and no hook data.
- To enable Solana: bring in `@solana/web3.js` + Circle's Solana CCTP program
  client, wire a Solana wallet adapter.

---

## 14. Repo Hygiene — Known Dead Code / Bloat

`knip` was run on 2026-04-24 to audit imports. Summary:

- **No unused files** — all source files are referenced.
- **Unused direct deps** — none flagged at last knip run after RainbowKit
  migration (wallet stack is `@rainbow-me/rainbowkit` + `wagmi`).
- **Unused test/lint devDeps** — `@testing-library/*`, `@eslint/compat`,
  `@eslint/eslintrc`, `@jest/globals`, `fake-indexeddb`, `eslint-config-next`
  are flagged by knip because they're used via config files, not `import`.
  They are legitimately required. **Don't remove.**
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

## 15. Theme & Visual Density

### 15.1 Themes

The app supports three themes: `light`, `dark`, and `system` (follows OS).
They live in `lib/theme/ThemeContext.tsx` and are switched by
`components/ThemeSwitcher.tsx`.

A previous `y2k` theme was removed. `ThemeContext.getStored()` still recognizes
the legacy `'y2k'` value in `localStorage` and silently migrates those users to
`'system'`. The migration list (`LEGACY_THEMES`) is the place to add any
future retired themes.

### 15.2 Global compactness

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

### 15.3 Chart filters

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

### 15.4 Holders & transactions pagination

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

## 16. Tests

`jest.config.js` sets up `ts-jest` + `jest-environment-jsdom`, with viem and
wagmi transformed via `transformIgnorePatterns`. Run with `npm test` (or
`npm run test:coverage`).

### 16.1 Test files (current)

| Suite | What it asserts |
| ---------------------------------------------------------- | --------------- |
| `lib/onchain/__tests__/reallocation.test.ts`               | `buildV1ReallocationPlan` ordering (withdrawals first, deposits after) and `maxUint256` catcher (default largest deposit + explicit `catcherKey` from dust recipient). |
| `lib/morpho/__tests__/utilization-risk.test.ts`          | `scoreUtilizationRatio`: 100 at target (90%), flat below, decays above. |
| `lib/format/__tests__/asset-decimals.test.ts`            | Known symbol decimals (USDC 6, cbBTC 8, WETH 18) and `resolveAssetDecimals` / `getTokenDisplayDecimals`. |
| `lib/morpho/__tests__/vault-history.test.ts`             | `computeSharePriceUsdSeries`, `normalizeVaultHistoryResponse` / share price mapping. |
When adding write builders in `vault-writes.ts`, add or restore ABI round-trip
tests under `lib/onchain/__tests__/vault-writes.test.ts`.

### 16.2 Conventions

- Pure logic lives in `lib/` and gets a `*.test.ts` next to it under
  `__tests__/`. Component behaviour gets a `*.test.tsx` under
  `components/.../__tests__/`.
- Do not call wagmi hooks from tests; mock the React Query hook
  (`useVaultHolders`, `useVaultTransactions`, etc.) at module level with
  `jest.mock(...)`. Tests should never hit the network.

---

_Last updated: 2026-06-22 (v1.0.8). When you change reallocation logic, allocation
list/filters (§5), caps/adapters display, V2 idData/Sentinel (§3.2, §4.2), Morpho
GraphQL field names (§4.4.1), vault list/sidebar (§4.3.1), vault overview/history
(share price in §4.4), risk scoring (§4.5), V2 idle/MetaMorpho/Blue display,
pending/emergency tabs, wallet stack, formatting, the CCTP flow, global density,
or add a new vault interaction, update Sections 3–6, 4.2–4.5, 9–10, 13, 15,
and 16 accordingly._
