# CLAUDE.md — Curator App Architecture & Vault Mechanics

This document is the canonical reference for AI assistants (and humans) working in
this repository. It captures the structure of the app, how Morpho V1 and V2 vaults
work, the subtle on-chain rules that caused real reallocation bugs in the past, and
the conventions the code follows today. Keep it up to date whenever you change
vault mechanics, contract wiring, or the data flow.

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
- **Onchain**: `viem` + `wagmi` (wallet/contract interactions)
- **GraphQL**: Morpho Blue API via `lib/morpho/graphql-client.ts`
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
  wallet/              Wagmi config + indexeddb polyfill

.env / .env.local      Public env vars: NEXT_PUBLIC_VAULT_* addresses, RPC URL,
                       Morpho API URL, auth secrets
```

---

## 3. Vault Mental Model

A **Morpho vault** is an ERC-4626 wrapper that supplies user deposits into one or
more Morpho Blue markets. Each market is identified by a 32-byte `Id =
keccak256(marketParams)`. Allocators (curator/allocator role) periodically
rebalance idle + market balances. V1 and V2 reach the same goal via _different_
contract semantics. Getting those semantics wrong is the #1 source of reverts.

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
- **No max-catcher needed** — V2 is delta-based so interest drift doesn't cause
  a balancing revert; the allocator simply chooses deltas.

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
   It builds `ResolvedTarget[]` (current assets + planned target + supply cap),
   then on submit calls `v1WriteConfigs.reallocate(...)` via `useVaultWrite`.
3. The sidebar/table uses `lib/format/number.ts` helpers
   (`formatRawTokenAmount`, `formatFullUSD`) for precision output.

### 4.2 V2 (`app/vault/v2/[address]/page.tsx`)

1. `useVaultV2Complete` fans out to:
   - `useVault(address)` for base data
   - `useVaultV2Risk` → `/api/vaults/v2/[id]/risk` (adapters + markets)
   - `useVaultV2Governance` → `/api/vaults/v2/[id]/governance` (caps, roles,
     timelocks)
2. `components/morpho/VaultV2Allocations.tsx` receives both `preloadedData`
   (governance) **and** `preloadedRisk`. Caps are resolved by hashing each
   target's `idData` to look up `CapInfo`.
3. Submits use `v2WriteConfigs.allocate/deallocate` wrapped in
   `v2WriteConfigs.multicall` when multiple moves are planned.

### 4.3 Caching

All GET-style API routes return JSON consumed by React Query. Query keys:

- `['vault', address]`
- `['vault-v1-market-risk', address]`
- `['vault-v2-risk', address]`
- `['vault-v2-governance', address]`
- `['vault-caps', address]`, `['vault-queues', address]`, `['vault-roles', address]`
- `['markets']`, `['morpho-markets']`, `['protocol-stats']`

Hooks live in `lib/hooks/` and should be the only entry points for reading
vault data from components.

---

## 5. Reallocation UX Conventions (current code)

These rules are baked into `AllocationV1.tsx` and `VaultV2Allocations.tsx` and
should be preserved:

1. **Edit inputs are human-readable strings** (decimal formatted). They are
   parsed into raw `bigint` using the asset's `decimals` via
   `parseUnits`/helpers in `lib/format/number.ts`.
2. **Cap validation runs client-side** before enabling the submit button.
   - V1: `target <= supplyCap` per market
   - V2: `target <= absoluteCap` and `target * 1e18 / firstTotalAssets <= relativeCap`
3. **Remaining balance banner** (`RemainingBanner`):
   - Shows `idle + sum(deltas)` → unallocated / balanced / over-allocated
   - Uses `formatRawTokenAmount` so commas + decimals render correctly
4. **Filters** (`components/morpho/AllocationFilters.tsx`):
   - Search, hide zero, only idle, hide idle, only with capacity, only edited
   - Sort by current, target, delta, capacity, name
   - Single source of truth via `AllocationFilterState` passed from parent
5. **Cap column** is always visible. It shows the absolute cap and the
   remaining headroom (`cap - current`).
6. **V1 submit** must include the `maxUint256` catcher on the largest deposit
   whenever the array contains at least one withdrawal. Never ship a V1
   reallocation without it.
7. **V2 submit** batches all operations via `multicall` so users sign once.
8. Use `formatRawTokenAmount(value, decimals)` **instead of** `Number(value) / 10**n`
   anywhere we need to display raw BigInts. This preserves precision and locale
   formatting (commas + dots) and avoids `1.23e-6` style output.

---

## 6. Number Formatting Conventions

All helpers live in `lib/format/number.ts`:

- `formatRawTokenAmount(value: bigint, decimals: number, options?)` — decimal
  string with grouping separators, up to `maxFractionDigits` (default 6).
- `formatFullUSD(value: number, options?)` — currency-formatted USD with full
  precision when required.
- `formatCompactNumber`, `formatPercent`, `formatBigIntValue`,
  `formatRelativeCap` — existing helpers for compact KPI displays.

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
  `lib/auth/curator-auth.ts`.
- Write UI (reallocate, caps, etc.) is gated on both wallet connection and
  curator role.

---

## 10. Common Pitfalls & Playbook

### V1 reallocation reverts with `InconsistentReallocation`

- Confirm the last deposit's `assets` is `maxUint256`.
- Confirm withdrawals come before deposits in the array.
- Confirm no rounding error in human → raw conversion (`parseUnits` with the
  right decimals).
- Confirm the sum of planned deltas is reasonable vs current idle + supply.

### V2 allocation reverts

- Check `absoluteCap` and `relativeCap` — both enforced on-chain per id.
- Check adapter identity and that `idData` encodes the right market/vault.
- When batching, the order inside `multicall` matters if `deallocate` must
  precede `allocate` to free up balance in the vault.

### Numbers rendering as `1.23e-6` or losing precision

- You're doing `Number(bigint) / 10 ** decimals` somewhere. Switch to
  `formatRawTokenAmount`.

### "Vault not found" on detail pages

- Address missing from `lib/config/vaults.ts` or from env `NEXT_PUBLIC_VAULT_*`.
- API route `/api/vaults/[id]` returns 404 if the vault isn't tracked.

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
| Shared filters UI                | `components/morpho/AllocationFilters.tsx`               |
| Number formatting                | `lib/format/number.ts`                                   |
| ABIs                             | `lib/onchain/abis.ts`                                    |
| Write configs                    | `lib/onchain/vault-writes.ts`                            |
| V1 reallocation planner (pure)   | `lib/onchain/reallocation.ts`                            |
| Write hook                       | `lib/hooks/useVaultWrite.ts`                             |
| V1 data hook                     | `lib/hooks/useVaultV1Complete.ts`                        |
| V2 data hook                     | `lib/hooks/useVaultV2Complete.ts`                        |
| V2 caps API                      | `app/api/vaults/v2/[id]/governance/route.ts`             |
| V2 risk API                      | `app/api/vaults/v2/[id]/risk/route.ts`                   |
| V1 market risk API               | `app/api/vaults/v1/[id]/market-risk/route.ts`            |
| Vault list API                   | `app/api/vaults/route.ts`, `app/api/vaults/[id]/route.ts`|
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
- **Unused direct deps** — `@reown/appkit-controllers` appears in
  `package.json` but isn't directly imported; it's a transitive peer of
  `@rainbow-me/rainbowkit` and should stay pinned.
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

- `TimeRangeFilter` — `All Time / 30D / 7D` (single button with a popover).
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
`npm run test:coverage`). V1/V2 vault **write** builders are covered by ABI
round-trip tests in `vault-writes.test.ts`; other suites cover reallocation,
CCTP, formatting, and chart date filtering.

### 16.1 Test files

| Suite | What it asserts |
| ---------------------------------------------------------- | --------------- |
| `lib/onchain/__tests__/vault-writes.test.ts`               | Every V1 (`metaMorphoV1Abi`) and V2 (`vaultV2Abi`) write builder produces calldata that round-trips through `encodeFunctionData` / `decodeFunctionData`. Catches drift between `abis.ts` and `vault-writes.ts`. |
| `lib/onchain/__tests__/reallocation.test.ts`               | The `buildV1ReallocationPlan` helper preserves the contract-required ordering (withdrawals first, deposits after, largest deposit = `maxUint256` catcher). Pure-function regression test for `InconsistentReallocation`. |
| `lib/cctp/__tests__/constants.test.ts`                     | Domain ids match Circle's registry; every enabled EVM chain has the full contract triple; disabled chains expose a `disabledReason`. |
| `lib/cctp/__tests__/attestation.test.ts`                   | `addressToBytes32`, `extractMessageFromReceipt`, `fetchAttestation` (with `fetch` mocked for 200/404/500 paths). |
| `lib/format/__tests__/number.test.ts`                      | `formatRawTokenAmount` regression test for the V1 holders "0.000" bug + every other `format*` helper. |
| `lib/utils/__tests__/date-filter.test.ts`                  | `filterDataByRange` honours the launch cutoff and the 7d/30d/all selectors. |

### 16.2 Conventions

- Pure logic lives in `lib/` and gets a `*.test.ts` next to it under
  `__tests__/`. Component behaviour gets a `*.test.tsx` under
  `components/.../__tests__/`.
- Do not call wagmi hooks from tests; mock the React Query hook
  (`useVaultHolders`, `useVaultTransactions`, etc.) at module level with
  `jest.mock(...)`. Tests should never hit the network.
- When extending a write config in `vault-writes.ts`, also extend
  `vault-writes.test.ts` with a round-trip case. The "every wrapper points
  at a function in the ABI" assertion will catch missing entries.

---

_Last updated: 2026-04-25. When you change reallocation logic, caps,
formatting, the CCTP flow, global density, or add a new vault interaction,
update Sections 3, 5, 6, 13, 15, and 16 accordingly._
