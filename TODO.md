# Curator TODO

Running task list for agents and humans. Work **Today** top-to-bottom unless directed otherwise. **Later** is out of scope unless asked. Log finished work under **Done** and in `docs/brain/CHANGELOG.md`.

---

## Today

- 
---

## Later

- [ ] Email alerts when vault/market issues arise.
- [ ] Upgrade risk scoring (Liquidation Headroom, Utilization, Coverage Ratio, Oracle Freshness) — review params for V1/V2; Utilization + oracle freshness required.
- [ ] Register Curator as a public Safe App (`public/manifest.json` + `NEXT_PUBLIC_APP_URL` already support custom URL).
- [ ] Create-market follow-ups: dead-deposit, seed-rate (oracle Safe payload deploy shipped).
- [ ] Brain: optionally split hot `CLAUDE.md` chapters into `docs/brain/topics/` when a section is edited often (avoid big-bang rewrite).

---

## Done

### 2026-07-14 — Morpho links + delete orphan ratings / CCTP docs

- [x] `/morpho` external links: App vaults, Liquidation, Docs; dropped Curator V1; dropped V1 realloc bot.
- [x] Deleted `/api/morpho-markets` + `lib/morpho/{service,compute,query,types,config}`; removed unused `@morpho-org/blue-sdk` / `blue-api-sdk`.
- [x] CLAUDE §14 CCTP marked removed (no `lib/cctp/` in tree).

### 2026-07-14 — Morpho hub UI + Sentinel booked fix + dead code

- [x] `/morpho` hub: one create-market card + cohesive external tools / bots lists (no scattered boxes).
- [x] Sentinel deallocate uses `bookedAllocationAssets` (not display) for Min/amounts.
- [x] Removed unused create-market Base constants, `listCreateMarketDeployments`, `wrapCuratorWriteWithTimelock`.

### 2026-07-14 — Create-market Morpho link + Sentinel Min deallocate

- [x] After `createMarket`, show market id + Morpho app / Curator / explorer links (`CreateMarketForm`).
- [x] Sentinel Deallocate **Max → Min** (withdrawable liquidity via `minTargetFromLiquidity`, same rule as Allocations).

### 2026-07-14 — Pre-prod create-market / network hardening

- [x] Fixed BASE_CHAIN_ID crash; validation race; Safe payload null tx; LOWs (factory required, ready gate, oracle value, reset filters, lazy deployments).
- [x] Removed auto switchChain on connect (wallet prompt spam); switch only via NetworkSwitcher.
- [x] create-market soft-fails missing Morpho deployments; lint + build clean.

---

### 2026-07-14 — Create-market tokens + oracle paste

- [x] Removed market presets; loan/collateral show ERC-20 ticker/name under address.
- [x] Oracle = paste address from oracles.morpho.dev (factory UI deferred).
- [x] Sentinel Zero out → Max (later → Min); Safe execute disabled without wallet.

### 2026-07-14 — Today batch (realloc / Safe / networks / Min / markets / decimals / revenue docs)

- [x] **Realloc Max → Idle UI** — `planningTotalRaw` = Σ booked + GraphQL idle (not `totalAssets`); Max sets Idle via `remainingDeployableIdleAfterMax` (no phantom accrual on Idle).
- [x] **Safe execute** — any connected wallet can execute once signatures ≥ threshold; owners still required to sign. UX copy updated.
- [x] **Networks** — Base / Ethereum / HyperEVM / Robinhood / Polygon only in wallet + `CURATOR_MARKET_NETWORKS`; `/markets` follows top-bar chain (no local switcher).
- [x] **Allocations Zero → Min** — Min = allocation minus withdrawable market liquidity (`minTargetFromLiquidity`).
- [x] **`/markets` $ stats** — USD primary + loan-token secondary amounts.
- [x] **Holders/txs decimals** — WETH/cbBTC 6 dp, USDC 3 via `getTokenDisplayDecimals`.
- [x] **Revenue docs** — CLAUDE §4.6: MoM vault-share `assetsUsd` (4 business vaults); negatives = mark-to-market; no loose wallet balances.

### 2026-07-14 — Dependency refresh

- [x] Updated packages to latest safe minors; pinned wagmi 2.x + ESLint 9.x (skipped wagmi 3, ESLint 10, TypeScript 7); lint + build clean.

### 2026-07-14 — Create Morpho market (v1.4.0)

- [x] Cloned repos; deps; `.env.local`; `/morpho/create-market` + Oracle Portal links; brain scaffold.

---

## Known

This repo wires ABI writes for **allocator** and **sentinel** roles. Curator/owner vault functions are not set up yet.
