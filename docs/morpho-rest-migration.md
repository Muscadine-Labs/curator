# Morpho GraphQL → REST migration (curator) — work in progress

Morpho is shutting down `https://api.morpho.org/graphql` on **January 29, 2027**.
Curator's vault, market, history, statement and activity routes all use it
(`lib/morpho/graphql-client.ts` → `morphoGraphQLClient`), so they have to move to
the REST API before then. Midnight already uses REST (`/v0/midnight/...`) except
for token metadata and historical prices.

Sources (reviewed 2026-11-19):

- Migration guide: https://docs.morpho.org/developers/api/migrate-from-graphql/
- REST reference: https://docs.morpho.org/api/
- OpenAPI spec (v1.0): https://docs.morpho.org/openapi.json

The paths and fields below come from that spec. They were also called live
against mpUSDC (`8453:0x8971…b496`) on 2026-11-19.

> **Work in progress.** This plan is a draft and will change: Morpho is still
> adding REST fields, and nothing below is decided. No code has changed yet.

---

## 1. The new API at a glance

| Topic | REST |
| --- | --- |
| Base URL | `https://api.morpho.org` (public). `https://private.api.morpho.org` takes an API key in the `x-api-key` header. |
| Versioning | Most routes are `/v0`. Only `/v1/vaults-v2/{v}/state` and `/v1/vaults-v2/{v}/apy-averages` are `/v1`. |
| Selectors | Vault / token / oracle = `8453:0xAddress`. Blue market = `8453:0xMarketId`. Midnight market = bare id. |
| Envelope | The result is under `data`. Lists add an opaque `cursor` (`null` on the last page). There is no `skip` / `first`. |
| Limits | Public host: 750 req/min **per IP** → 429 with `Retry-After: 600`. Above 3,334 / 10 min the IP is blocked for 7 days, so the **sustained** ceiling is about 333 req/min. A key raises the limits. |
| Unknown params | Silently ignored. |
| Amounts | Integer strings (base units). Use `BigInt`. |
| Fees / LLTV / caps | `*_wad` strings (1e18 = 100%). `management_fee_wad` is per second (× 31,536,000 = yearly). `relative_cap_wad` (not `relativeCap`). `absolute_cap` 2^256−1 = no limit. |
| Share price | `share_price_ray` (/1e27). |
| APY | Decimal fraction, nullable, **window averages only** (no instant APY), rewards excluded. |
| USD | **No USD fields anywhere.** `/v0/tokens/{t}/price` is spot, one token per call. There is no historical price route. |
| Timestamps | Unix seconds (integers). Token price `timestamp`, oracle `last_updated_at`, `last_indexed_block`, activity `block_number` and `*_block_number` are strings. |

**Rate limit is the biggest risk.** Curator fans out per vault and per market,
and one GraphQL query often becomes several REST calls. Get an API key (server-only
env, e.g. `MORPHO_API_KEY`) and keep the 30s `withServerResponseCache` dedupe.

---

## 2. Endpoint map (what exists)

| Need | REST endpoint | Key fields |
| --- | --- | --- |
| Vault config | `GET /v0/vaults-v2/{v}` | `name`, `symbol`, `asset{address,decimals,symbol}`, `owner`, `curator`, `governance.timelocks[]{function_name,timelock_seconds,is_abdicated,abdicated_at_timestamp}`, `timelock_seconds`, `gates{send_assets,…}`, fees + recipients, `max_rate_per_second_wad`, `adapter_registry`, `liquidity_adapter`, `liquidity_data` |
| Vault live state | `GET /v1/vaults-v2/{v}/state` | `total_assets`, `total_supply`, `withdrawable_assets` (= old `liquidity`), `idle_assets`, `allocated_assets`, `share_price_ray` |
| Vault roles | `GET /v0/vaults-v2/{v}/allocators`, `/sentinels` | `role_address`, `tx_hash`, `grant_block_number` |
| Adapters + caps | `GET /v0/vaults-v2/{v}/allocations` | `allocations[]{adapter_address, adapter_kind (morpho_market_v1 \| morpho_market_v1_v2 \| morpho_vault_v1 \| morpho_vault_v2 \| unknown; **our vaults return `morpho_market_v1_v2`**), target, caps[]{cap_id, cap_data, cap_type (adapter \| market_v1 \| collateral), absolute_cap, relative_cap_wad, allocated_assets, market_id?, expected_supply_assets?, real_assets?, pending{absolute_cap, relative_cap_wad}}}`, `unscoped_caps[]` |
| Caps / allocation history | `GET /v0/vaults-v2/{v}/caps/history?lookback=&cap_id=&cap_type=` (filter is camelCase `marketV1`, while `/allocations` returns `market_v1`) | per cap: `history[]{timestamp, allocation, absolute_cap, relative_cap_wad, relative_allocation}` |
| Pending timelocked changes | `GET /v0/vaults-v2/{v}/pending-governance-actions` | `action_type` (`add_adapter`, `increase_absolute_cap`, `set_is_allocator`, `decrease_timelock`, …), `parameters` (decoded arguments; `null` for `unknown`), `executable_at_timestamp`, `submitted_transaction_hash` |
| Force-deallocation | `GET /v0/vaults-v2/{v}/withdrawal-options` | `idle_assets`, `liquidity_adapter_available_assets`, `adapter_penalties[]{force_deallocatable_assets, penalty_rate_wad}` |
| Public Allocator | `GET /v0/vaults-v2/{v}/markets/{m}/reallocatable-liquidity`, `GET /v0/blue/markets/{m}/public-allocator-vaults` | caps, `can_pull_from_idle`, `penalty_wad`, routes |
| Vault history | `GET /v0/vaults-v2/{v}/state/history?lookback=`, `/apy/history?lookback=` | totals, `share_price_ray`, `withdrawable_assets`, `idle_assets`; `apy`. Sampling depends on `lookback` (live mpUSDC, 2026-11-19): `one_day` / `seven_days` hourly, `thirty_days` / `ninety_days` daily, `one_year` **weekly**, `inception` picked by age (daily today; can become monthly). **`apy/history` points are trailing averages, not per-bucket APY:** `seven_days` returns 1-day averages, `thirty_days` 7-day averages, `ninety_days` / `inception` 30-day averages. |
| APY average | `GET /v1/vaults-v2/{v}/apy-averages?lookback=one_hour…inception` | `apy` |
| Vault list | `GET /v0/vaults-v2?chain_ids=8453&curators=…&owners=…` | **Listed vaults only** (no `listed` param). Muscadine vaults are unlisted and return `[]`, so the vault list stays in `lib/config/vaults.ts`. Per-vault routes do return unlisted vaults. |
| One wallet's position | `GET /v0/vaults-v2/{v}/users/{u}/position`, `/history`, `/activity`, `/performance` | `shares`, `assets`; activity `type` = deposit / withdraw / shares_transfer_in / shares_transfer_out; `net_earnings_assets` |
| Wallet's vaults | `GET /v0/vaults-v2/users/{u}/positions?active_only=false` | max 100 rows per page |
| Blue market | `GET /v0/blue/markets/{m}`, `/state`, `/liquidity`, `/apy-averages`, `/apy/history`, `/state/history` | `loan_token`, `collateral_token`, `oracle_address`, `irm_address`, `lltv_wad`; `total_supply_assets` / `total_borrow_assets` (+ shares), `fee_wad`, `rate_at_target_per_second_wad` (`/state` only, not in history); `market_liquidity`, `reallocatable_liquidity`, `borrow_amount_to_target_utilization`; `supply_apy_averages` / `borrow_apy_averages` (`6h` `24h` `7d` `30d` `90d` `1y`); `total_collateral_assets` only in `state/history` |
| Market list | `GET /v0/blue/markets?chain_id=8453&listed=true&loan_token=&collateral_token=&market_id=` | identity only. `sort_by` = `market_id` \| `lltv_wad`. Limit up to 1000. |
| Borrower health | `GET /v0/blue/markets/{m}/positions/health?ltv_wad_gte=` | borrowers only: `user_address`, `collateral_assets`, `borrow_shares`, `ltv_wad` |
| Vaults in a market | `GET /v0/blue/markets/{m}/vaults` | `vault_address`, `version` |
| Oracle | `GET /v0/oracles/{o}/state` | `price` (string), `last_updated_at` |
| Token | `GET /v0/tokens/{t}`, `/price` | `decimals`, `symbol`, `logo_uri`; `price` (spot USD, nullable) |
| Curator profile | `GET /v0/curators/{8453:addr}/details` | `curators[]{id, name, logo_uri, socials}` |

Supply shares → assets: `shares × (total_supply_assets + 1) / (total_supply_shares + 1e6)`,
using integer division.

---

## 3. File-by-file plan

| File / route | GraphQL today | REST plan |
| --- | --- | --- |
| `lib/morpho/graphql-client.ts` | `graphql-request`, logs `extensions.warnings` | New `lib/morpho/rest-client.ts` (`morphoRest(path, params)`): cursor paging helper, `Retry-After`, API key header, error mapping. Remove `graphql-request` at the end. |
| `lib/morpho/batch-vault-graphql.ts` (aliased `vaultV2ByAddress` batches) | One query for N vaults | REST has no batch. Run per-vault calls in parallel under one `withServerResponseCache` key. Re-measure protocol-stats call counts (today: 2 Morpho calls per refresh). |
| `app/api/vaults/route.ts`, `app/api/vaults/[id]/route.ts` | name, TVL(USD), liquidity, APY, fees, caps, recent txs, rewards, warnings, metadata | `/v0/vaults-v2/{v}` + `/v1/.../state` + `/v1/.../apy-averages` + token price (USD). Fee wrapper underlying from `/allocations` (`adapter_kind: morpho_vault_v2`, `target.vault_address`). **No** `rewards` (Merkl), `warnings`, `listed`, `metadata.description/image`. Recent txs: see gaps. |
| `app/api/vaults/[id]/governance/route.ts`, `lib/morpho/vault-v2-api.ts` | roles, timelocks, caps, adapters, liquidityAdapter, market state | `/v0/vaults-v2/{v}` + `/allocators` + `/sentinels` + `/allocations` (caps with `cap_data` = idData, so `resolveCapIdData` can be cross-checked against `cap_id`). Market labels and params: `/v0/blue/markets/{m}` + `/v0/tokens/{t}`. Keep the on-chain overlay. |
| `app/api/vaults/[id]/risk/route.ts`, `lib/morpho/fetch-markets-by-id.ts` | Positions with market state, USD, APY, utilization, oracle, `realizedBadDebt` | Per market: `/state` (supply/borrow totals → utilization, liquidity), `/apy-averages`, `/liquidity`, `state/history` latest point for collateral, `/v0/oracles/{o}/state`, and token price for USD. **No `realizedBadDebt`**: the bad-debt F override needs another source (on chain: Blue `market()` totals vs. events) or must be dropped. |
| `app/api/vaults/[id]/pending/route.ts` (`pendingConfigs`) | `functionName`, `data`, `validAt` | `/pending-governance-actions`. **No raw calldata.** Accept/revoke needs the submitted `data` bytes: re-encode through an `action_type` → function map plus `parameters` (`id_data` for cap increases; `unknown` actions have no parameters), or read the submit tx (`submitted_transaction_hash`) input on chain. Cap decreases never appear (not timelocked). |
| `app/api/vaults/[id]/history/route.ts`, `lib/morpho/vault-history.ts` | `historicalState` TVL(USD), `avgNetApy`, share price | `/state/history` + `/apy/history`. Share price = `share_price_ray`/1e27. USD series = tokens × price (spot) or DefiLlama daily. |
| `app/api/vaults/[id]/holders/route.ts`, `lib/morpho/paginate-v2-positions.ts` | `vaultV2ByAddress.positions` (all holders) | **Gap.** No vault-wide holder list. |
| `app/api/vaults/[id]/transactions/route.ts`, `app/api/protocol-transactions/route.ts` | `vaultV2transactions` (vault-wide) | **Gap.** Activity only exists per wallet (`/users/{u}/position/activity`). |
| `app/api/vaults/[id]/reallocations/route.ts`, allocation part of `lib/morpho/vault-activity.server.ts` | `vaultV2AllocationTransactions` | **Partial.** `/caps/history` gives allocation per cap over time (hourly on short lookbacks), not txs (no hash / sender). Safe-history governance decode is unaffected. |
| `app/api/protocol-stats/route.ts`, `app/api/protocol-users/route.ts` | TVL series + depositor addresses | TVL: `/state/history` per vault × price. Depositors / unique users: **gap** (no holder list). |
| `lib/morpho/compute-treasury-statement.ts` (`userByAddress` histories), `lib/morpho/treasury-transfers.ts` (`vaultV2transactions` for the treasury) | DAY `shares` / `assets` / `assetsUsd` per vault; treasury deposits / transfers | `/v0/vaults-v2/users/{TREASURY}/positions?active_only=false`, then per vault `/position/history?lookback=inception` (daily while the history is young; Morpho picks the interval by age and it can become monthly, which would break daily income, so check before relying on it) and `/position/activity` (deposits, `shares_transfer_in` with `from_address`; `0x0` = fee mint). **No `assetsUsd`**: use DefiLlama daily prices (already a dependency). Check the REST daily timestamps against the "Day alignment" rule in `CLAUDE.md` §4.6 before reusing `utcDayClosedBySnapshot`. |
| `lib/morpho/curator-markets.ts` (markets browser, `marketById`, Muscadine index) | One `markets` query with state, USD, APY, sorted by `SizeUsd` | `/v0/blue/markets?listed=true` returns identity only. Size, liquidity, APY and USD are ~3 calls per market plus token prices, which won't fit the ~333/min sustained limit across 1,000+ Base markets. Options: restrict the browser to listed markets with a long server cache, show size only for Muscadine markets, or compute totals on chain (Blue `market(id)` multicall + oracle). The Muscadine index comes from `/allocations` per business vault. |
| `lib/morpho/market-activity.server.ts` | `marketCollateralAtRisk`, `marketTransactions` (liquidations), `marketPositions` (suppliers / borrowers), `supplyingVaultV2s`, rate history | Rates: `/apy/history` (trailing averages: `ninety_days` returns 30-day averages, so today's "90-day daily APY" chart would be smoothed) + `/state/history`; `rate_at_target_per_second_wad` only from current `/state`. Borrowers: `/positions/health` (ltv per borrower, so collateral-at-risk can be built locally with `ltv_wad_gte`). Vaults in market: `/v0/blue/markets/{m}/vaults`, then each vault's `/allocations`. **Gaps:** liquidations list, supplier list, Morpho's collateral-at-risk curve, IRM curve (`currentIrmCurve`; compute locally from `rate_at_target`). |
| `app/api/bots/activity/route.ts` | `historicalState.avgNetApy`, `marketById`, `markets(where loan/collateral)` | `/apy/history`, `/v0/blue/markets/{m}`, `/v0/blue/markets?loan_token=&collateral_token=` + `/v0/tokens/{t}` for symbols. |
| `lib/morpho/known-tokens.ts` (`assets(where address_in)`, `assetByAddress`) | Batched metadata + spot price | `/v0/tokens/{t}` + `/price`, one call per token (`prefetchAssets` loses batching: parallelize with a concurrency cap and keep the 30s cache). The on-chain `decimals()` / `symbol()` fallback stays. |
| `lib/morpho/midnight-markets.ts` (`assetByAddress`, `historicalPriceUsd`) | Token metadata, daily loan-token USD | Metadata → `/v0/tokens/{t}`. **No historical price**: use DefiLlama (`coins.llama.fi`) or spot. |

On-chain reads (risk overlay, Safe, gates, writes) are unaffected.

---

## 4. Gaps (nothing in REST as of 2026-11-19)

1. Vault-wide **holders / depositors** (holders table, unique users KPI).
2. Vault-wide **transactions** (vault and protocol transaction tables).
3. **Allocation transactions** (only per-cap allocation history).
4. Market **liquidations**, **suppliers**, `marketCollateralAtRisk`, IRM curve.
5. `realizedBadDebt` (risk F override).
6. Instant APYs (`netApy`, `supplyApy`, `borrowApy`). Only window averages exist.
7. All USD values and **historical prices**.
8. Market list with state (size / liquidity / APY) for sorting.
9. Vault `rewards`, `warnings`, `listed`, `metadata`.
10. Pending config **raw calldata**.

For each gap, decide by Jan 29, 2027 whether to (a) read it on chain (event logs
via RPC; free Alchemy caps `eth_getLogs` at 10 blocks, so this needs a paid tier
or an indexer), (b) ask Morpho whether a route is coming, or (c) drop the feature.

---

## 5. Suggested order

1. API key + `rest-client.ts` + token helpers (`known-tokens`).
2. Vault detail: `[id]`, governance, pending, history, risk (direct equivalents).
3. Vault list, protocol-stats TVL, bots activity, treasury statement.
4. Markets browser + market activity (needs a design decision on gaps).
5. Decide on the gap features. Remove `graphql-request`, `batch-vault-graphql.ts`, the GraphQL references in `lib/constants/core.ts`, and the §4.4.1 schema-drift table. Update `CLAUDE.md` / `AGENTS.md`.

Each step: compare old vs new responses on every business vault, then run
`npm test`, `npm run lint` and `npm run build`.

---

## 6. Proposed approach: hybrid on-chain + REST (under consideration)

> **Not decided.** This is the direction we are leaning toward. Morpho is
> still adding fields to the REST API (instant APY, USD, holders or vault-wide
> transactions may arrive before the shutdown), so re-check the OpenAPI spec
> before building and move anything REST starts covering back to REST if that
> is simpler.

Idea: read **current state on chain** in a few batched multicalls, cache it on
the server (30s, `withServerResponseCache`), and share it across routes. Use
**Morpho REST only for history, per-wallet history, pending and roles**.
Goal: as few calls as possible. This extends the on-chain overlay curator
already runs (`overlay-v2-onchain-caps.ts`).

### 6.1 On-chain vault snapshot (all configured vaults, about 3 `eth_call`s)

| Round | Reads (every vault in the same multicall) |
| --- | --- |
| 1 | `totalAssets`, `totalSupply`, `asset`, fees, `maxRate`, owner, curator, `liquidityAdapter` / `liquidityData`, adapter list, idle (`asset.balanceOf(vault)`) |
| 2 | Each adapter's funded markets (`marketIds(i)`); `absoluteCap` / `relativeCap` / `allocation` per cap id (ids from REST `/allocations`, see below); live adapter position (`expectedSupplyAssets` / `realAssets`) |
| 3 | `Morpho.market(id)` (totals, fee) + IRM `borrowRateView` per market; oracle reads (existing decoder); Chainlink USD for vault assets |


Verified on chain (mpUSDC, 2026-11-19): `adaptersLength` / `adapters(i)`,
`liquidityAdapter`, `timelock(selector)`, `abdicated(selector)` and the
adapter's `realAssets` all read fine. The Blue market adapter lists markets
with `marketIds(i)` / `marketIdsLength()`, but **only markets that hold funds**
(2 of the vault's 5 market caps). Capped-but-empty markets and collateral caps
cannot be enumerated on chain, so the **cap id list comes from REST
`/allocations`** (cached about 1h). Values are then read on chain, and market
params from `Morpho.idToMarketParams(id)`.

What it computes:
- TVL, liquidity and idle.
- Instant supply and borrow APY, utilization.
- Vault net APY (rewards excluded).
- Caps, allocations and adapter rollups.
- The inputs for `computeBlueMarketRiskScores`.

The vault detail, governance, risk and vault list routes all read this one object.

Call efficiency:
- **Split cache by how often data changes.** Market params, adapter lists, decimals and timelocks are cached for about an hour, or cleared after a governance write / Safe execute. Totals are cached for 30s.
- `publicClient` already batches same-tick reads into one Multicall3 call (`batchSize: 4_096`).
- `eth_call` is billed per request, not per inner call.

### 6.2 Markets browser

- Market ids come from `/v0/blue/markets?chain_id=8453&listed=true` (cache about 1h; new listings are rare).
- Size, liquidity, utilization and instant APY come from `Morpho.market(id)` for every listed market in a couple of batched multicalls, plus a second round of `idToMarketParams` / `borrowRateView`.
- USD comes from `/v0/tokens/{t}/price` for each **distinct loan token** (about 20), cached 5 min.
- This replaces about 3 REST calls per market, which would not fit the rate limit.

### 6.3 Morpho REST only for what the chain cannot give

| Data | Endpoint | Cache |
| --- | --- | --- |
| Vault TVL / APY / share-price history | `state/history`, `apy/history` | Daily / weekly lookbacks about 1h; hourly (`one_day`, `seven_days`) 5 min |
| Allocation over time | `caps/history` | 5 min |
| Market rate history | `blue/markets/{m}/apy/history`, `state/history` | About 1h for daily |
| Borrower health (collateral at risk) | `blue/markets/{m}/positions/health?ltv_wad_gte=` | 30s |
| Pending changes, roles | `pending-governance-actions`, `sentinels`, `allocators` | 30s, plus an on-chain recheck |
| Treasury statement | `users/{treasury}/positions`, `position/history`, `position/activity` + DefiLlama daily prices | 30s (existing) |
| Token metadata (unknown tokens) | `/v0/tokens/{t}` | Long; the on-chain fallback stays |

Use a server-only Morpho API key.

### 6.4 List features (holders, vault txs, allocation txs, liquidations, suppliers)

Neither multicall nor REST covers these today. Options, in order of preference:
1. **Defer.** They are internal-only. Ship without them, or keep them on GraphQL until Jan 29, 2027, and see whether they are missed or whether Morpho adds routes.
2. **If needed, one small indexer** (Ponder or Envio) over our vaults' Deposit / Withdraw / Transfer / Allocate / Deallocate events and Blue liquidations in our markets. One indexer covers all of these plus the treasury statement. It costs a database and a host.

Do not page `eth_getLogs` per request: free Alchemy caps it at 10 blocks.

### 6.5 Order if adopted

1. Snapshot module + REST helper (`rest-client.ts`). Switch vault detail / governance / risk / vault list.
2. Markets browser on multicall + loan-token prices.
3. History, pending, roles, bots and treasury to REST.
4. Indexer decision. Remove `graphql-request` and `batch-vault-graphql.ts`.
