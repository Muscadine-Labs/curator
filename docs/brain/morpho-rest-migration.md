# Morpho GraphQL → REST migration (curator)

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

Status: **plan only. No code has changed yet.**

---

## 1. The new API at a glance

| Topic | REST |
| --- | --- |
| Base URL | `https://api.morpho.org` (public). `https://private.api.morpho.org` takes an API key in the `x-api-key` header. |
| Versioning | Most routes are `/v0`. Only `/v1/vaults-v2/{v}/state` and `/v1/vaults-v2/{v}/apy-averages` are `/v1`. |
| Selectors | Vault / token / oracle = `8453:0xAddress`. Blue market = `8453:0xMarketId`. Midnight market = bare id. |
| Envelope | The result is under `data`. Lists add an opaque `cursor` (`null` on the last page). There is no `skip` / `first`. |
| Limits | Public host: 750 req/min **per IP** → 429 with `Retry-After: 600`. Above 3,334 / 10 min the IP is blocked for 7 days. A key raises the limits. |
| Unknown params | Silently ignored. |
| Amounts | Integer strings (base units). Use `BigInt`. |
| Fees / LLTV / caps | `*_wad` strings (1e18 = 100%). `management_fee_wad` is per second (× 31,536,000 = yearly). `relative_cap_wad` (not `relativeCap`). `absolute_cap` 2^256−1 = no limit. |
| Share price | `share_price_ray` (/1e27). |
| APY | Decimal fraction, nullable, **window averages only** (no instant APY), rewards excluded. |
| USD | **No USD fields anywhere.** `/v0/tokens/{t}/price` is spot, one token per call. There is no historical price route. |
| Timestamps | Unix seconds (integers). Token price `timestamp`, oracle `last_updated_at` and `*_block_number` are strings. |

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
| Adapters + caps | `GET /v0/vaults-v2/{v}/allocations` | `allocations[]{adapter_address, adapter_kind (morpho_market_v1 \| morpho_vault_v2 \| …), target, caps[]{cap_id, cap_data, cap_type (adapter \| market_v1 \| collateral), absolute_cap, relative_cap_wad, allocated_assets, market_id?, expected_supply_assets?, real_assets?, pending{absolute_cap, relative_cap_wad}}}`, `unscoped_caps[]` |
| Caps / allocation history | `GET /v0/vaults-v2/{v}/caps/history?lookback=&cap_id=&cap_type=` | per cap: `history[]{timestamp, allocation, absolute_cap, relative_cap_wad, relative_allocation}` |
| Pending timelocked changes | `GET /v0/vaults-v2/{v}/pending-governance-actions` | `action_type` (`add_adapter`, `increase_absolute_cap`, `set_is_allocator`, `decrease_timelock`, …), `parameters` (decoded, with `selector`), `executable_at_timestamp`, `submitted_transaction_hash` |
| Force-deallocation | `GET /v0/vaults-v2/{v}/withdrawal-options` | `idle_assets`, `liquidity_adapter_available_assets`, `adapter_penalties[]{force_deallocatable_assets, penalty_rate_wad}` |
| Public Allocator | `GET /v0/vaults-v2/{v}/markets/{m}/reallocatable-liquidity`, `GET /v0/blue/markets/{m}/public-allocator-vaults` | caps, `can_pull_from_idle`, `penalty_wad`, routes |
| Vault history | `GET /v0/vaults-v2/{v}/state/history?lookback=`, `/apy/history?lookback=` | totals, `share_price_ray`, `withdrawable_assets`, `idle_assets`; `apy`. `inception` = daily, short windows = hourly. |
| APY average | `GET /v1/vaults-v2/{v}/apy-averages?lookback=one_hour…inception` | `apy` |
| Vault list | `GET /v0/vaults-v2?chain_ids=8453&curators=…&owners=…` | config only (no state, no `listed` filter) |
| One wallet's position | `GET /v0/vaults-v2/{v}/users/{u}/position`, `/history`, `/activity`, `/performance` | `shares`, `assets`; activity `type` = deposit / withdraw / shares_transfer_in / shares_transfer_out; `net_earnings_assets` |
| Wallet's vaults | `GET /v0/vaults-v2/users/{u}/positions?active_only=false` | max 100 rows per page |
| Blue market | `GET /v0/blue/markets/{m}`, `/state`, `/liquidity`, `/apy-averages`, `/apy/history`, `/state/history` | `loan_token`, `collateral_token`, `oracle_address`, `irm_address`, `lltv_wad`; `total_supply_assets` / `total_borrow_assets` (+ shares), `fee_wad`, `rate_at_target_per_second_wad`; `market_liquidity`, `reallocatable_liquidity`, `borrow_amount_to_target_utilization`; `supply_apy_averages` / `borrow_apy_averages` (`6h` `24h` `7d` `30d` `90d` `1y`); `total_collateral_assets` only in `state/history` |
| Market list | `GET /v0/blue/markets?chain_id=8453&listed=true&loan_token=&collateral_token=&market_id=` | identity only. `sort_by` = `market_id` \| `lltv_wad`. Limit up to 1000. |
| Borrower health | `GET /v0/blue/markets/{m}/positions/health?ltv_wad_gte=` | borrowers only: `user_address`, `collateral_assets`, `borrow_shares`, `ltv_wad` |
| Vaults in a market | `GET /v0/blue/markets/{m}/vaults` | `vault_address`, `version` |
| Oracle | `GET /v0/oracles/{o}/state` | `price` (string), `last_updated_at` |
| Token | `GET /v0/tokens/{t}`, `/price` | `decimals`, `symbol`, `logo_uri`; `price` (spot USD, nullable) |
| Curator profile | `GET /v0/curators/{8453:addr}/details` | `name`, `logo_uri`, socials |

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
| `app/api/vaults/[id]/pending/route.ts` (`pendingConfigs`) | `functionName`, `data`, `validAt` | `/pending-governance-actions`. **No raw calldata.** Accept/revoke needs the submitted `data` bytes: re-encode from `action_type` + `parameters` (selector included), or read the submit tx (`submitted_transaction_hash`) input on chain. Cap decreases never appear (not timelocked). |
| `app/api/vaults/[id]/history/route.ts`, `lib/morpho/vault-history.ts` | `historicalState` TVL(USD), `avgNetApy`, share price | `/state/history` + `/apy/history`. Share price = `share_price_ray`/1e27. USD series = tokens × price (spot) or DefiLlama daily. |
| `app/api/vaults/[id]/holders/route.ts`, `lib/morpho/paginate-v2-positions.ts` | `vaultV2ByAddress.positions` (all holders) | **Gap.** No vault-wide holder list. |
| `app/api/vaults/[id]/transactions/route.ts`, `app/api/protocol-transactions/route.ts` | `vaultV2transactions` (vault-wide) | **Gap.** Activity only exists per wallet (`/users/{u}/position/activity`). |
| `app/api/vaults/[id]/reallocations/route.ts`, allocation part of `lib/morpho/vault-activity.server.ts` | `vaultV2AllocationTransactions` | **Partial.** `/caps/history` gives allocation per cap over time (hourly on short lookbacks), not txs (no hash / sender). Safe-history governance decode is unaffected. |
| `app/api/protocol-stats/route.ts`, `app/api/protocol-users/route.ts` | TVL series + depositor addresses | TVL: `/state/history` per vault × price. Depositors / unique users: **gap** (no holder list). |
| `lib/morpho/compute-treasury-statement.ts` (`userByAddress` histories), `lib/morpho/treasury-transfers.ts` (`vaultV2transactions` for the treasury) | DAY `shares` / `assets` / `assetsUsd` per vault; treasury deposits / transfers | `/v0/vaults-v2/users/{TREASURY}/positions?active_only=false`, then per vault `/position/history?lookback=inception` (daily) and `/position/activity` (deposits, `shares_transfer_in` with `from_address`; `0x0` = fee mint). **No `assetsUsd`**: use DefiLlama daily prices (already a dependency). Check the REST daily timestamps against the "Day alignment" rule in `CLAUDE.md` §4.6 before reusing `utcDayClosedBySnapshot`. |
| `lib/morpho/curator-markets.ts` (markets browser, `marketById`, Muscadine index) | One `markets` query with state, USD, APY, sorted by `SizeUsd` | `/v0/blue/markets?listed=true` returns identity only. Size, liquidity, APY and USD are ~3 calls per market plus token prices, which won't fit 750/min across 1,000+ Base markets. Options: restrict the browser to listed markets with a long server cache, show size only for Muscadine markets, or compute totals on chain (Blue `market(id)` multicall + oracle). The Muscadine index comes from `/allocations` per business vault. |
| `lib/morpho/market-activity.server.ts` | `marketCollateralAtRisk`, `marketTransactions` (liquidations), `marketPositions` (suppliers / borrowers), `supplyingVaultV2s`, rate history | Rates: `/apy/history` + `/state/history` (+ `rate_at_target_per_second_wad`). Borrowers: `/positions/health` (ltv per borrower, so collateral-at-risk can be built locally with `ltv_wad_gte`). Vaults in market: `/v0/blue/markets/{m}/vaults`, then each vault's `/allocations`. **Gaps:** liquidations list, supplier list, Morpho's collateral-at-risk curve, IRM curve (`currentIrmCurve`; compute locally from `rate_at_target`). |
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
5. Decide on the gap features. Remove `graphql-request`, `batch-vault-graphql.ts`, and the §4.4.1 schema-drift table. Update `CLAUDE.md` / `AGENTS.md`.

Each step: compare old vs new responses on every business vault, then run
`npm test`, `npm run lint` and `npm run build`.
