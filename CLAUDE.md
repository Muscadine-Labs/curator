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
| Write hook                       | `lib/hooks/useVaultWrite.ts`                             |
| V1 data hook                     | `lib/hooks/useVaultV1Complete.ts`                        |
| V2 data hook                     | `lib/hooks/useVaultV2Complete.ts`                        |
| V2 caps API                      | `app/api/vaults/v2/[id]/governance/route.ts`             |
| V2 risk API                      | `app/api/vaults/v2/[id]/risk/route.ts`                   |
| V1 market risk API               | `app/api/vaults/v1/[id]/market-risk/route.ts`            |
| Vault list API                   | `app/api/vaults/route.ts`, `app/api/vaults/[id]/route.ts`|
| Vault addresses                  | `lib/config/vaults.ts`                                   |

---

_Last updated: 2026-04-24. When you change reallocation logic, caps, or
formatting, update Sections 3, 5, and 6 accordingly._
