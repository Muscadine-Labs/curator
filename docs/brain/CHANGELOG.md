# Brain changelog

Append-only session log. Newest first. Keep entries short; link files.

---

## 2026-07-14 — Post-review fixes (create-market sticky success, Sentinel placeholder)

- Create-market: set market id only on success; clear success UI when MarketParams change.
- Sentinel illiquid Min placeholder shows `0` (not full booked amount).
- Docs: AGENTS create-market multi-chain; CLAUDE per-row deallocate; idle error “Min a row”.

---

- Hub links: [app vaults](https://app.morpho.org/vaults), [liquidation](https://liquidation.morpho.org/), [docs](https://docs.morpho.org/get-started/); removed Curator V1 + V1 realloc bot.
- Deleted unused ratings API stack (`/api/morpho-markets`, `service`/`compute`/`query`/`types`/`config`) and unused `@morpho-org/blue-sdk` / `blue-api-sdk`.
- CLAUDE §14: CCTP docs removed (code not in tree).

---

## 2026-07-14 — Morpho hub UI + Sentinel booked fix + dead code

- `/morpho`: cohesive hub (create-market primary + external UIs list + automation bots list).
- Sentinel deallocate/Min: `bookedAllocationAssets` (not display `allocationAssets`).
- Removed unused: Base-only create-market address constants, `listCreateMarketDeployments`, `wrapCuratorWriteWithTimelock`.

---

## 2026-07-14 — Create-market Morpho link + Sentinel Min deallocate

- `CreateMarketForm`: persist market id on create; success card shows id + Morpho app / Curator / explorer links; pre-create Market ID also links Morpho.
- Sentinel Deallocate **Max → Min**: amount = withdrawable liquidity (`minTargetFromLiquidity`), matching Allocations Min.
- Files: `CreateMarketForm.tsx`, `VaultV2Sentinel.tsx`.

---

## 2026-07-14 — Pre-prod review: create-market + network hardening

- Fixed create-market `BASE_CHAIN_ID` crash; validation gen race; Safe payload `transactions[0]` null-safe.
- Network: `ready` gate for markets fetch; no auto `switchChain` on connect (explicit switcher only).
- `useVaultWrite` optional `value`; oracle deploy passes payload value; lazy create-market deployments.
- Lint + `npm run build` clean.

---

## 2026-07-14 — Multi-chain create-market + network switcher without wallet

- Top-bar `NetworkSwitcher` (localStorage preference) works disconnected; syncs wallet when connected.
- `/markets` + create-market follow preference; createMarket uses per-chain Morpho/IRM/oracle factory from `@morpho-org/morpho-ts`.
- RainbowKit `chainStatus="none"` (app owns network UI).

---

## 2026-07-14 — Oracle portal Safe JSON → deploy + auto-fill

- Paste Gnosis Safe payload from oracles.morpho.dev; wallet deploys `createMorphoChainlinkOracleV2` on Base factory `0x2DC2…bd3d`; receipt event fills oracle address.
- Files: `oracle-safe-payload.ts`, `CreateMarketForm.tsx`, Base factory constant fix.

---

## 2026-07-14 — Create-market tokens + oracle paste; Sentinel Max; Safe execute disable

- Removed create-market presets. Loan/collateral addresses resolve ERC-20 symbol/name/decimals (`erc20-token-meta.ts`).
- Oracle UX: paste address after oracles.morpho.dev deploy; validate code + factory `isMorphoChainlinkOracleV2`.
- Sentinel “Zero out” → **Max** (fills full deallocate amount; not Allocations Min).
- Safe Execute disabled when wallet disconnected.
- TypeScript 7 still blocked (`typescript-eslint` peer `<6.1.0`).

---

## 2026-07-14 — Review: docs + TODO closed-loop fix

- Verified Today-batch code vs CHANGELOG (realloc Idle, Safe execute, networks, Min, markets tokens, display decimals, revenue §4.6).
- Fixed `TODO.md` Done (batch was only in CHANGELOG; Done had create-market only).
- Restored dep-refresh Done note; noted CLAUDE §5/§13 still thin on Min + permissionless execute (AGENTS has invariants).
- Lint + `tsc --noEmit` clean. Minor UX: Execute button clickable without wallet (throws connect error).

---

## 2026-07-14 — Dependency refresh (stay wagmi 2 / ESLint 9)

- Bumped safe minors (Next 16.2.10, viem, Morpho SDKs, lucide, etc.).
- Held: wagmi 2.x, ESLint 9.x, TypeScript 6.0.3 (TS 7 breaks typescript-eslint).

---

## 2026-07-14 — Finish Today TODO batch

### Realloc Idle after Max
- Root cause: Idle after Max used `totalAssets − Σ strategy` (accrual phantom).
- Fix: `planningTotalRaw = Σ booked + GraphQL idle`; Max Idle = `remainingDeployableIdleAfterMax`.
- Files: `VaultV2Allocations.tsx`, `v2-rebalance-plan.ts` (`minTargetFromLiquidity`, `remainingDeployableIdleAfterMax`).

### Safe execute
- Execute was already open; relaxed UX copy so non-owners know they can execute.
- Files: `SafeTransactionQueue.tsx`, `VaultWriteDestinationSelect.tsx`, `AGENTS.md`.

### Networks
- Wallet + markets: Base, Ethereum, HyperEVM, Robinhood (4663), Polygon only.
- `/markets` uses `useChainId` (no page switcher).
- Files: `lib/constants/core.ts`, `lib/wallet/config.ts`, `CuratorMarketsBrowser.tsx`, `morpho-app-links.ts`.

### Min / markets tokens / decimals
- Zero → Min (liquidity-aware).
- Markets: USD + raw loan token amounts.
- Holders/txs/history: display decimals 6/3 via `getTokenDisplayDecimals`.

### Revenue (documented, no code change)
- Monthly = Σ MoM `assetsUsd` on treasury V2 vault shares (4 business vaults).
- Negatives without withdrawals = mark-to-market (esp. WETH/cbBTC).
- Not loose wallet balances. See CLAUDE §4.6.

### Brain
- Closed loop scaffold complete; optional topic split left in Later.

---

## 2026-07-14 — Create market + brain scaffold (v1.4.0)

**Shipped:** `/morpho/create-market`, oracle portal links, brain hub + Morpho MCP.
**Follow-ups:** oracle deploy / dead-deposit / seed in UI; fill `.env.local` keys.
