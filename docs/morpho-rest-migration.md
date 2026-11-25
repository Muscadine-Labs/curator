# Morpho GraphQL → REST migration (curator) — done

Morpho shuts down `https://api.morpho.org/graphql` on **January 29, 2027**; its
deprecation warnings give **2027-01-25** as the field removal date, so that is the
deadline. Curator no longer calls GraphQL: `graphql-request` and `graphql` are
removed, and every Morpho read goes through Morpho REST, the chain, or DefiLlama.

Sources: https://docs.morpho.org/api/ and the OpenAPI spec
https://docs.morpho.org/openapi.json (read it before touching a read: REST silently
ignores unknown params, and Morpho keeps adding routes). Every route was checked
against the GraphQL version (branch `claude/morpho-rest-dec2`) on all six
configured vaults on 2026-11-25; results below.

**Decision (2026-11-25): no paid RPC tier and no indexer.** Anything that would need
long-range `eth_getLogs` (free Alchemy: 10 blocks per call) is dropped until Morpho
REST adds a route. Section 4 lists each drop with restore steps.

---

## 1. Building blocks

| Piece | File | Notes |
| --- | --- | --- |
| HTTP client | `src/lib/morpho/rest-client.ts` | `morphoRestGet` / `morphoRestList` (cursor paging, max 20 pages, throws rather than return a cut list). 30s in-memory + Next data cache, in-flight dedupe, retries 429/5xx honouring `Retry-After` ≤3s, last good response served 10 min on a rate limit or outage. `revalidate: 0` = fresh. `MorphoRestError { status, rateLimited }`. Optional server-only `MORPHO_API_KEY` → `private.api.morpho.org`. |
| Typed reads | `src/lib/morpho/rest-data.ts` | Vault, state, allocations, roles, withdrawal options, token, price, market, market state. Math: `marketRates` / `adaptiveCurveBorrowRate` (Adaptive Curve IRM), `managementFeePerYear`, `wadToFraction`, `allRestCaps`, `adapterTypeName`. |
| Markets | `src/lib/morpho/rest-markets.ts` | `loadMarketDetails` (params, tokens, state, rates; 10 at a time; takes params the caller already has), `loadPrices`, `loadMarketCollateralAssets` (`state/history` newest `total_collateral_assets`). |
| Vault snapshot | `src/lib/morpho/rest-vault.server.ts` | `loadRestVaultSnapshot`: one cached (30s) read of a vault shaped like the old GraphQL objects (adapters, caps, liquidity data, timelocks), shared by the list, detail, governance, risk, markets index and market suppliers. `loadRiskPositions` for the risk route. |
| Historical USD | `src/lib/defillama/historical-prices.ts` | `fetchDailyPricesUsd` / `priceOnDay` from DefiLlama `coins.llama.fi/chart` (Morpho's own price provider). REST has no historical prices. |

## 2. Route by route

| Area | GraphQL had | Now | Checked (2026-11-25) |
| --- | --- | --- | --- |
| Vault list `/api/vaults` | `vaultV2ByAddress` batch | Snapshot per vault | Every field identical (except `depositors`, below) |
| Vault detail `/api/vaults/[id]` | `vaultV2ByAddress` | Snapshot | Identical except APY note, `depositors`, `warnings` |
| Governance | caps, adapters, roles, timelocks, liquidity data, fees | Snapshot (`/allocations`, `/sentinels`, `/allocators`, `/withdrawal-options` for force penalties, vault for timelocks / fees / recipients; selector from the ABI) + existing on-chain overlays | Listed caps, roles, timelocks, adapters, penalties, liquidity adapter identical on 6 vaults |
| Risk | positions with market state, collateral, bad debt | Snapshot + `loadRiskPositions` (collateral from `state/history`) | Vault risk scores within 0.2 points |
| Vault history | `historicalState` | `state/history?lookback=inception`; USD = DefiLlama daily price; APY = realized daily APY from the share price (`realizedApySeries`) | Deposits, USD, share price identical; APY within normal day-to-day noise |
| Protocol stats | TVL series batch, depositors | REST `state/history` per vault × DefiLlama price | TVL history identical (e.g. $580,449 40 days ago on both) |
| Pending | `pendingConfigs` | REST submit tx hashes → receipts → `Submit` calldata → `executableAt` (done in the Dec 2 PR) | Identical |
| Token metadata / prices | `assets(where)` batch | `/v0/tokens/{t}` and `/price` per token, 8 at a time (`prefetchAssets`) | — |
| Cap labels / cap-only markets | 1,000-market GraphQL index | REST by market id and token address (`fetch-markets-by-id.ts`) | — |
| Markets browser | top 1,000 markets with state | Morpho-listed Blue markets + Muscadine markets (`/v0/blue/markets?listed=true` + state per market), cached 2 min | All 101 listed markets present; supply, liquidity, utilization, APY match; Muscadine flags identical |
| Market detail | `marketById` | REST market, state, `/liquidity`, `/apy-averages` (6h row), collateral from `state/history`, creation time from the list route; oracle decoded on chain as before | Identical except bad debt, oracle creation date / type, total liquidity (below) |
| Market activity | borrowers, suppliers, liquidations, collateral at risk, rate history, IRM curve | Realized daily supply / borrow APY from share growth (`state/history`), utilization history, IRM curve from the current rate at target, Muscadine vault suppliers from snapshots | Rate and utilization history, rate at target, IRM curve match |
| Midnight | loan-token historical price | DefiLlama daily price (rest was already REST) | — |
| Treasury statement | `userByAddress` position history (V1 + V2) with `assetsUsd`; `vaultV2transactions` | REST positions (`/v0/vaults-v1|v2/users/{u}/positions`) + `/position/history?lookback=inception` (00:00 UTC points; off-grid "now" point dropped) × DefiLlama price; transfers from `/position/activity` per vault | Every month within a few cents |
| Bots | market labels, vault roles, APY around txs | REST market + tokens; REST roles; REST `apy/history` (last 7 days) or realized APY from the share price | Builds and returns; no Safe API key in the test container to exercise rows |

## 3. Trade-offs (accepted 2026-11-25)

- **Instant APY is computed.** Vault net APY = Σ(funded market supply APY × vault supply) / total assets × (1 − performance fee) − management fee; market rates come from the Adaptive Curve IRM at the indexed utilization with the stored rate at target (same as Morpho's figure). Non-Adaptive-Curve markets fall back to REST 6h averages. GraphQL `avgNetApy` (a 6h-ish average) now shows the instant figure in the detail's `avgApy` fields.
- **Rewards are 0** (not in REST; Merkl has its own API). No configured vault has rewards.
- **Markets browser:** "Market size" = supply USD (GraphQL `sizeUsd` was a different, sometimes larger Morpho measure). The APY column is the instant supply APY (was a 6h net average; the detail page still shows Morpho's 6h average). Total liquidity (Public Allocator–inclusive) is only on the detail page, from REST `/liquidity` (`market_liquidity + reallocatable_liquidity`), which counts more reallocatable liquidity than GraphQL's figure did. The list is cached **2 minutes** (exception to the 30s ceiling): ~110 REST calls per refresh would otherwise use most of the 333 req/min sustained public limit.
- **Unlisted Blue markets** that no Muscadine vault caps are not in the browser.
- **Vault status:** REST has no `listed` flag on the vault object; every configured vault was `listed: false` on GraphQL, so status stays "paused".
- **`depositors`** on vault rows is `null` (it was hard-coded 0 on the list already).

## 4. Dropped until Morpho adds them

Each: what went away, what is shown now, how to restore.

### 4.1 Vault holders and the unique-users KPI
- **Gone:** vault Overview **Holders** section, dashboard **Users** KPI and its detail (top holders across vaults), `/api/vaults/[id]/holders`, `/api/protocol-users`, `useVaultHolders`, `useProtocolUsers`, `VaultHolders.tsx`, `DepositorAddress.tsx`, `paginate-v2-positions.ts`, `vault-adapter-holders.server.ts` (adapter filtering for user counts).
- **Restore when** REST has a vault-wide positions route: bring the files back from git history (commit "Vault list and protocol stats read Morpho REST; drop holder and transaction views"), swap their GraphQL `positions` pages for the REST route, re-add the KPI card in `src/app/page.tsx` and `users` in `ProtocolStatKey`.

### 4.2 Vault and protocol transaction tables
- **Gone:** vault Overview **Transactions** section, the protocol transactions table under Users, `/api/vaults/[id]/transactions`, `/api/protocol-transactions`, `useVaultTransactions`, `VaultTransactions.tsx`, `vault-v2-tx-amounts.ts`, `vault-v2-transaction-utils.ts`.
- **Restore when** REST has a vault-wide activity route (rows like `/users/{u}/position/activity`): same commit as 4.1.

### 4.3 Allocation history
- Dropped in the Dec 2 PR (curator#93): Allocation-tab history and Activity allocation rows. Restore from that PR when REST lists allocate / deallocate transactions.

### 4.4 Market liquidations, full supplier list, borrowers, collateral at risk
- **Now:** those panels say "Not available from Morpho's API yet" (`MarketActivity.unavailable`); Suppliers lists Muscadine vaults only.
- **Borrowers and collateral at risk restore themselves**: `loadBorrowers` already reads REST `/positions/health` (in Morpho's spec; 404 on 2026-11-25) and builds the local curve with `collateralAtRiskCurve`. Check the row fields against the live route when it ships.
- **Liquidations / suppliers:** add the REST route in `market-activity.server.ts` and clear the matching `unavailable` flag.

### 4.5 Realized / unrealized bad debt
- **Now:** `null`; the risk "bad debt > $1 ⇒ F" override cannot fire, and the detail rows show "—".
- **Restore when** REST exposes bad debt: set `realizedBadDebt` in `loadRiskPositions` and `fetchCuratorMarketDetail`.

### 4.6 Morpho `warnings`, oracle creation date / indexed type
- **Now:** empty / null. Restore from REST if added.

## 5. Notes for future reads

- REST amounts are integer strings. `share_price_ray` is decimals-adjusted (assets per share × 1e27); raw share → asset conversions use `total_assets / total_supply`.
- `management_fee_wad` and `setManagementFee` calldata are **per second** (× 31,536,000 for a year).
- With no liquidity adapter, REST `liquidity_data` is keccak256 of empty bytes (`0xc5d2…a470`), not a market id.
- `/v0/blue/markets/{m}/state` has no collateral total; `state/history` does (`total_collateral_assets`).
- REST history ends with an off-grid "now" point; drop it when a series must be whole days.
- Public limit 750 req/min per IP; 3,334 in 10 min blocks the IP for 7 days. Set `MORPHO_API_KEY` on Vercel before raising poll rates or adding per-market reads.
