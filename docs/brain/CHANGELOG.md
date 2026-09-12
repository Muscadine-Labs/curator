# Brain changelog

Append-only session log. Newest first. Keep entries short; link files.

---

## 2026-09-12 — Pre-prod review fixes (Bugbot + Security)

- Gate txs imported from Transaction Service decode `setIsWhitelisted` / `setIsWhitelister` / `multicall` on the configured send-assets gate (`lib/safe/decode-vault-calldata-preview.ts`). Preview shows the account and allow/deny.
- MultiSend batch refuses **any** `serviceSynced` row (including the earliest nonce) and any `DelegateCall`.
- JSON import drops stored previews and re-classifies from calldata (`sanitizeImportedPending`).
- Login rate limits use Upstash REST when `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` are set; Redis errors fail closed. Without them, limits stay per-instance (warned in production).
- Production HMAC requires `CURATOR_SESSION_SECRET` (no login-password fallback except during `next build`).

---

## 2026-09-12 — Safe subagent leftovers + dep bumps

- Queue **auto-shares** to the Transaction Service when `NEXT_PUBLIC_SAFE_API_KEY` and a proposer wallet are present (`lib/safe/auto-share.ts`); uses wagmi `connector.getProvider()`, not `window.ethereum`.
- Next nonce = max(on-chain, local pending, **service pending**) + 1.
- Safe App embed: if `sdk.txs.send` returns a different hash, replace the local `safeTxHash`/nonce instead of leaving a forked proposal.
- Service-imported Curator txs titled from `inferSafeTxSource` (sends are “Send …”, not “Vault action”).
- Rebalance **re-finalizes** `allocation(id)` + idle cash at Confirm, not only at preview open.
- Custom token add invalidates balances; failed ERC-20 reads stay omitted (not `0`).
- Wrapper APY falls back to `netApy` when `avgNetApy` is null. Sentinel overview always includes Idle.
- Bumped in-range: Next `16.3.5`, React `19.3.0`, protocol-kit `8.0.7`, lucide `1.45.0`. Left ESLint 9, wagmi 2, ox 0.14, vitest 3, TypeScript 6 (majors).

---

## 2026-09-12 — TODO.md Today: Vineyard, revenue, Safe, gates, Polygon, Wyoming

- **Vineyard**: `lib/config/usdc-vineyard.ts`, `scripts/create-usdc-vineyard-vault.ts`, `scripts/usdc-vineyard/README.md`, `npm run vault:vineyard`. Prints full pre-deploy plan + live Prime snapshot. `--broadcast` deploys with Prime roles/timelocks; does **not** set or abdicate Morpho adapter registry `0x5C2531…`.
- **DefiLlama**: `app/api/monthly-statement-defillama/route.ts` uses reported protocol revenue as Total Revenue even when 0; Cost of Revenue = yields − protocol take.
- **Polygon** dropped from `CURATOR_MARKET_NETWORKS` / wallet. **Wyoming** dropped from ledger (`lib/constants/google-ledger.ts`). **NameSilo → Cloudflare** on `/muscadine-frontends` (`lib/constants/links.ts`).
- **Send-assets gate UI**: vault overview (`VaultV2GatesRead`) + `/curator/gates` (`SendAssetsGatePanel`). `GET /api/gates/[address]`. Writes queue to Allocator/Curator Safe.
- **Allocation / Sentinel**: fail closed on overshoot; caps keyed by `keccak256(encodeMarketCapIdData)`; unknown caps stay listed; `% Alloc` vs display total; `useVaultV2Governance({ initialData })`; `finalizeRebalancePlan` fails if `allocation(id)` or idle cash read fails; Sentinel deallocate needs booked + market params; wallet reject is cancel.
- **Safe**: History tab (`GET /api/safe/[address]/history`), Settings (modules/guard + address book), MultiSend batch (`queueSafeBatch`), nonce = on-chain + queued local, sign/execute via wagmi + Base switch, send redirects to Transactions, import merges by `safeTxHash`.
- **Depositors**: `DepositorAddress` shows Basename / ENS beside the truncated address (`useWalletDisplayName`).
- Deploy Vineyard is **not** done in this session — config + scripts only.

---

## 2026-09-08 — Safe review pass: transfer decoding, trust rules, tests

- **Signing safety**: a transfer imported back from the Transaction Service had no stored preview, so `resolveSafePendingPreview` fell through to vault decoding. Vault shares are ERC-20s at a tracked vault address, so a share transfer rendered as *"Vault transaction / Undecoded calldata"* with a "View vault" link — an owner was asked to sign with no recipient and no amount on screen. `decode-vault-calldata-preview.ts` now decodes ERC-20 `transfer` and bare native value transfers, and `inferSafeTxSource` classifies them before vault inference.
- **Login bypass reintroduced and removed**: an intermediate revision trusted `cf-connecting-ip` whenever `CURATOR_TRUSTED_PROXY_HOPS` was set. Any caller can send that header, so it restored unlimited guessing (verified: 25/25 forged-header attempts allowed). Trust is now hop-counted `x-forwarded-for` only, plus `x-vercel-forwarded-for` on Vercel. Explicit hop config takes precedence over Vercel auto-detection.
- **Send dialog preselection**: the dialog stayed mounted, so `useState(initialToken)` kept its first value and clicking Send on any row opened with the *first* asset selected (verified: clicking WETH Prime opened ETH). Dialogs now mount only while open. Added zero-address and self-send guards.
- Auth limits are consumed atomically before the body is read (was peek-then-consume across an `await`); the client bucket is charged first so a locked-out client cannot drain the global budget.
- `initSafeProtocolKit` no longer caches signer-bound kits — they capture the wallet's chain id at init and would sign for the wrong chain after a network switch. Read-only kits (fixed Base RPC) are still cached.
- `qrcode` is imported on demand inside the Receive dialog instead of shipping a ~30KB chunk with every Safe page; QR failure now shows a fallback instead of an endless skeleton.
- Wallet errors go through `TxErrorBanner` / `summarizeWalletError` like the rest of the app, so a user rejection reads "Cancelled." instead of a viem dump.
- `?tokens=` capped at 50 entries; dropped a pointless balance refetch after queueing (a proposal changes nothing on-chain).
- Tests: `npm test` is **vitest** (CLAUDE.md §17 claimed Jest was unconfigured — corrected). Added 34 tests across `lib/utils/rate-limit.test.ts`, `lib/safe/build-transfer-calldata.test.ts`, `lib/safe/tokens.test.ts`, `lib/safe/decode-vault-calldata-preview.test.ts`. 77 pass.
- Verified out of band: all 14 declared token decimals match the chain; the app's viem client has `multicall3` configured (without it both new multicalls would throw).

## 2026-09-08 — Safe assets, send/receive, app.safe.global-style tabs

- `/safe/[role]` split into **Home / Assets / Transactions** under a shared layout with `SafeAccountHeader` (`base:0x…` address + copy, threshold, ETH balance, Send/Receive) and `SafeRoleSubnav`. Post-queue redirects now land on `.../transactions`.
- **Send from a Safe** (all five roles): `build-transfer-calldata.ts` (native value transfer or ERC-20 `transfer`, always `Call`) → `queue-transfer.ts` → the existing queue/sign/execute path. `queueVaultWriteInSafe` generalized to `queueSafeTransaction` and now threads `value`.
- **Receive**: QR of the chain-prefixed address plus a direct wallet → Safe transfer (`useSafeFunding`, no signatures needed). Added `qrcode` dep.
- **Assets**: `GET /api/safe/[address]/balances` reads native + USDC/WETH/cbBTC + every configured vault's shares in one multicall; unknown tokens added by address and persisted per role in localStorage. No Transaction Service balances call — free tier is 5 req/s.
- Optimizations: `readSafeOnChainInfo` is one multicall instead of four `eth_call`s; `initSafeProtocolKit` caches the **read-only** kit per Safe (failed inits evicted). Signer-bound kits are never cached — they capture the wallet's chain id at init, so a cached one would sign for the wrong chain after a network switch.
- Send dialog mounts only while open: it previously kept `initialToken` from first mount, so clicking Send on a row always preselected the first asset (verified: clicking WETH Prime opened with ETH selected). Added zero-address and self-send guards on an irreversible action.
- Display fixes: Safe amounts use 6 dp (`SAFE_AMOUNT_DP`) so ETH gas float and share dust stop rendering as `0.00`; vault-share rows use the vault name as the symbol so two USDC vaults are distinguishable; a `transfer` source no longer resolves to a "view vault" link.

## 2026-09-08 — Auth rate-limit bypass fixed

- `POST /api/auth/verify` keyed its 10/15min bucket off `x-forwarded-for`, so rotating that header gave a fresh bucket per guess — unlimited password attempts. Verified against the running app: 15 rotated-IP guesses all returned 401 before, all 429 after attempt 10 now.
- `resolveClientIp()` (`lib/utils/rate-limit.ts`) only trusts a forwarded IP when `CURATOR_TRUSTED_PROXY_HOPS` says how many proxies are in front (or on Vercel via `x-vercel-forwarded-for`); otherwise every unattributable client shares one bucket.
- Every attempt is charged atomically before the body is read (`consumeRateLimit` checks and increments in one synchronous step); a successful login clears both buckets. Added `AUTH_LOGIN_GLOBAL_MAX_ATTEMPTS` (50) over a **1-minute** window as a spray backstop. The short global window is deliberate — a global counter is a lockout an attacker can hold open, and a 15-minute one locked out the real admin indefinitely.
- `cf-connecting-ip` is deliberately **not** trusted: any caller can send it, and an intermediate revision that trusted it whenever a hop count was set reopened the full bypass (verified: 25/25 forged-header guesses allowed). Cloudflare appends the client IP to `x-forwarded-for`, so hop counting covers that deployment.
- General BFF routes keep best-effort IP keying: a shared bucket there would let one client lock out everyone.

## 2026-09-05 — Allow Reown + esbuild install scripts

- `package.json` `allowScripts` now includes `@reown/appkit`, `esbuild`, and `fsevents` so npm 12 / Vercel stop warning on those postinstalls.

## 2026-09-05 — Sidebar + vault list load time

- Vaults sidebar renders from config (`getSidebarNavVaults`) — no Morpho wait, no 30s poll, wrappers omitted.
- `GET /api/vaults` no longer pulls treasury or 1k positions per vault (catalog/transact never used them).
- Vault detail skips treasury + unused tx list. Gate RPC moved off governance onto `GET /api/vaults/[id]/gates` (Fee wrapper tab only).

## 2026-09-05 — Fee wrapper tab on underlying vaults

- Strategy vaults with a configured wrapper get `/vault/[address]/fee-wrapper` (condensed TVL, users, history, fees, roles, gates, max rate, timelocks).
- Wrapper contract URLs redirect to that tab; vaults sidebar lists underlyings only. Catalog Wrapper rows still link through `getVaultPageHref`.
- Governance overlay now includes on-chain gate addresses (`lib/morpho/vault-v2-gate-state.ts`).

## 2026-09-05 — Gate verify CLI + app config-only allowlist

- `npm run gates:verify` — RPC read of `sendAssetsGate`, gate `isWhitelisted`, vault `canSendAssets` vs config.
- Docs: app never calls gate RPC; run verify after every allowlist change (`docs/brain/deposit-gates.md`).

## 2026-09-05 — Send-assets gate config (no deploy)

- `lib/config/deposit-gates.ts`: underlying-only gate on four strategy vaults; gate whitelist = 4 adapters + 5 partner/Treasury depositors (9 total). Wrappers stay open.
- Gate ABI + `npm run gates:calldata` (requires `SEND_ASSETS_GATE_ADDRESS` after external deploy).
- Docs: `docs/brain/deposit-gates.md`.

## 2026-09-04 — Wrapper adapters + treasury migration

- Users / holders / txs label **MorphoVaultV2Adapter** addresses as the parent fee wrapper (`adapterAddress` on wrapper config). The adapter — not the wrapper vault — holds the underlying.
- Unique-user KPI and the Users directory skip wrapper adapters (protocol internals, not depositors). Holders and txs still label them.
- Treasury income no longer treats redeem-underlying → deposit-wrapper as a loss: unmatched opening self-deposits are not subtracted (`treasury-self-deposit.ts`). Self-deposits match FIFO and only on business vaults.

## 2026-09-04 — Vault list kind groups + depositor labels

- `/vaults` and the vaults sidebar group **Underlying** then **Wrapper**, then Prime / Frontier / Test (`groupVaultsByKindAndCategory`).
- Overview Users, vault holders, and tx counterparties label fee wrappers and the Treasury Safe.
- Treasury `VAULT_ASSET_MAP` is built from `getVaultAddressesForBusinessViews()` plus V1 leftovers; transfers use `treasuryAssetKeyForVault`.

## 2026-09-04 — Income months + Morpho create links

- Treasury/DefiLlama statements keep every month after first income, including $0.00 (e.g. August 2026).
- Curator Morpho hub: create [market](https://curator.morpho.org/markets/create), [vault](https://curator.morpho.org/vaults/create), [fee wrapper](https://curator.morpho.org/fee-wrapper/create). Create-market page links Morpho as an alternative. Removed muscadine-bots `upstream` branch links.

## 2026-09-04 — Fee wrapper display suffix

- Vault names append ` (wrapper)` via `withFeeWrapperLabel` (transact, catalog, sidebar, vault page, protocol/user/tx APIs).

## 2026-09-04 — Unstick cancelled wallet txs

- Preview dialogs stay dismissible until a real tx hash is broadcast, except while
  a Safe queue is in flight. Wallet reject resets wagmi so Confirming does not stick.

## 2026-09-04 — Dependabot #114 / #115

- Overrides: `browserslist>=4.28.7` (CVE-2026-73088, babel via eslint-config-next) and `decode-uri-component>=0.5.0` (CVE-2026-45822, WalletConnect `query-string`).

## 2026-09-04 — Review: AppKit cleanup + underlying vault naming

- Wallet: RPC helpers live in `lib/wallet/rpc.ts` so Basename lookup does not load WagmiAdapter. Custom AppKit networks avoid the `viem/chains` barrel. AppKit overlay timeout is cleared on unmount.
- History APY hiding is derived (no setState-in-effect). User-facing fee-wrapper copy is **underlying vault** (`underlyingAddress` / `underlying`); Morpho GraphQL still uses `innerVault`.

## 2026-09-04 — Reown AppKit + two more fee wrappers

- Replaced RainbowKit with Reown AppKit (`@reown/appkit` + wagmi adapter), same pattern as the muscadine app: no SIWE, featured Rabby/MetaMask/Base/Phantom, theme sync, cookie wagmi storage.
- Connect button shows Basename/ENS; wallet RPCs fall back to public endpoints instead of Alchemy `/demo`. History hides a flat 0% APY until Morpho indexes a rate (new wrappers).
- Tracked cbBTC Prime wrapper `wmpcbBTC` (`0x0e0a857d2AF1A2d43c82d1FA54766239CAb70147` → mpCBBTC) and USDC Test wrapper (`0x9efdc9986052e058ef717c02d500Ca0456d8c1cb` → testing-usdc).

## 2026-09-02 — Fee wrapper review: names, users, inner fallback

- Transact + configured labels use Morpho/on-chain names (`USDC Prime`); keep **Open on Morpho**. Wrappers and test vaults stay in transact.
- Unique-user / active-vault KPIs include wrappers; protocol TVL still excludes them. Catalog deposits subtitle notes the exclusion.
- `innerVaultAddress` shares the child vault env default and fills GraphQL `innerVault` misses (`mergeInnerVaultInfo`).

## 2026-09-02 — Fee wrapper Vault V2 GraphQL on /vaults

- Tracked three Morpho fee wrappers (Prime USDC `wmpUSDC`, Frontier USDC `wmfUSDC`, Prime WETH `wmpWETH`) as `kind: 'feeWrapper'` in `lib/config/vaults.ts`.
- GraphQL: `... on MorphoVaultV2Adapter { innerVault { … } }` on list, governance, and risk. Allocate/deallocate `data` is empty (`EMPTY_ADAPTER_DATA`).
- Catalog/sidebar show wrappers; protocol TVL and muscadine market index skip them (deposits live in the inner vault). Treasury still includes wrapper fees.
- Allocation section **Morpho Vault V2**; Risk links to the inner vault. Docs: Morpho [Fee Wrapper](https://docs.morpho.org/developers/earn/concepts/fee-wrapper/).

## 2026-09-02 — Review fixes: load race, preview lock, full-repay

- Positions `loadMarket` catch/finally ignore stale requests; token-meta failure clears balances; Load/expand disabled while signing.
- `TxPreviewDialog` locks Confirm/Escape/overlay on click (before React `isLoading`) so a double click cannot send two txs.
- Full repay uses shares only when wallet covers debt. Vault full-exit uses bigint `isNearFullAmount` (not `Number`).
- Allocation sort uses a row map; header sort uses a hoisted `onSortColumn` + functional `setFilters`. Positions amount fields parse once per render (`evaluateAmountInput`).

## 2026-09-02 — Allocation column header sort cycle

- Vault `/allocation` headers (Rate / APY, Util., Liquidity, caps, Allocation, % Alloc., Name) cycle **high→low → low→high → default**.
- Default sort is `default` (allocated high→low, no header highlight). `cycleAllocationHeaderSort` in `lib/allocation/allocation-filters.ts`.
- Files: `AllocationListView.tsx`, `VaultV2Allocations.tsx`, `AllocationFilters.tsx`.

## 2026-09-02 — Transact + positions review modal

- `/vaults/transact` and `/markets/positions` open `TxPreviewDialog` before the wallet signs (same chrome as Allocation / Sentinel).
- User actions use `buildUserTxPreview` in `lib/morpho/tx-preview.ts`. Dialog stays open through signing and shows a confirmed tx link until Done.
- Files: `TxPreviewDialog.tsx`, `VaultTransactBox.tsx`, `MarketPositionBox.tsx`.

## 2026-09-02 — Review: pair search, MAX repay, deps

- Pair search matches symbol words/prefixes (`ETH` no longer hits `WETH`); market ids still substring-match.
- Full repay preflight no longer requires a 1% extra wallet balance (broke MAX when wallet = debt). Shares repay still used for close.
- Positions load: one RPC pass, ignore stale responses, skip the duplicate refresh after load.
- MAX parse/fill uses the same `formatUnits`/`parseUnits` decimals. Deps: Next 16.3.4, lucide-react 1.39, viem 2.56.3 (still ESLint 9 / wagmi 2 / TypeScript 6).

## 2026-09-02 — Markets pair search + positions MAX

- Browse Loan / Collateral / Search now filter Midnight as well as Blue (`lib/morpho/market-pair-filter.ts`, `CuratorMarketsBrowser.tsx`). Pair queries match tokens in any order (`cbBTC/USDC` hits a USDC loan + cbBTC collateral Midnight book).
- `/markets/positions`: Muscadine-app MAX on every amount (`AmountMaxInput.tsx`). Wallet ERC-20 for supply/add collateral; LLTV-buffered borrow; repay `min(wallet, debt)` and shares on full close; max-safe collateral withdraw; full supply withdraw by shares. Docs: Morpho borrow/earn assets-flow (not Vault V2 `maxDeposit`/`maxWithdraw`, which return 0).

## 2026-08-29 — Vercel install/build log noise

- `package.json` `allowScripts` for `bufferutil`, `keccak`, `unrs-resolver`, `utf-8-validate` (npm 12 install-script policy).
- Skip `CURATOR_SESSION_SECRET` warn during `next build` (`NEXT_PHASE=phase-production-build`). Session HMAC falls back to `CURATOR_ADMIN_PASSWORD` when the dedicated secret is unset.

## 2026-08-29 — AI review: bugs, deps, dead code

- Caps relative rings: `vault.analytics.totalAssetsUnderlying` (detail API also returns it at top level). Catalog APY matches detail (`netApy` → `avgNetApy` → `apy`).
- Login: IP rate limit on `POST /api/auth/verify`; timing-safe password compare; production requires `CURATOR_SESSION_SECRET`; session version stamp. Dependabot overrides: nanoid, postcss, js-yaml, hono, socket.io-parser.
- Dropped unused exports (`AllocationListShell`, midnight helpers). Deps updated within pins (no wagmi 3 / ESLint 10 / TypeScript 7).

## 2026-08-29 — Vaults catalog + Morpho Caps / tab order

- `/vaults` uses Morpho Curator-style tables (network, deposits, liquidity adapter, liquidity, APY) still grouped Prime / Frontier / Vineyard / Test.
- Vault tabs: Overview → Allocation → Caps → Risk → Timelocks → Sentinel. `/analytics` redirects to `/risk`.
- Caps: grouped market / collateral / adapter tables with utilization rings. Public Allocator toggle when the V2 Blue PA is an allocator ([docs](https://docs.morpho.org/learn/concepts/public-allocator/)).

## 2026-08-29 — Midnight market pages

- `/midnight/[id]` is a Midnight-only detail page (order book, maturity, outstanding units, per-collateral LLTV/cursor/oracle). Not Blue APY/utilization/IRM.
- External link: `https://markets.morpho.org/fixed/{chain}/{marketId}`. Browse rows go in-app (`curatorMidnightMarketHref`).
- BFF: `GET /api/markets/midnight/[id]` (market + state + book).

## 2026-08-29 — Name public allocator on Bots

- `0xAED2…e412` labeled **Public Allocator** (`lib/constants/bots.ts`).

## 2026-08-29 — Review fixes: auth, treasury, cache, GraphQL batching

- HttpOnly `curator_session` cookie + `proxy.ts` on `/api/*`. `apiFetch` sends cookies. BFFs `private, no-store`. Each BFF also checks the session (proxy is not an auth boundary).
- Treasury income: daily **share** change × day's USD; GraphQL self-deposits excluded.
- `/api/vaults` one aliased GraphQL query + 30s cache; protocol-users paginate positions.
- Shared `getBaseRpcUrl()` (no Alchemy `/demo`). UTC calendar for statements/charts.
- Bots roles/realloc batched; Rebater surfaces truncated/error.

## 2026-08-29 — Bots: Safe is the bot, not the EOA

- Dropped **Bot** label on `0xf35B…B333`. Allocator/Sentinel Safes are the bot actors (`lib/constants/bots.ts`); Alchemy watch is Safes only.

## 2026-08-29 — Curator tools at `/curator`

- Hub moved from `/morpho` to `/curator`; bots at `/curator/bots`. `/morpho` and `/morpho/bots` redirect (`next.config.ts`).

## 2026-08-29 — Drop Morpho vault-v2-reallocation-bot from hub

- Removed [vault-v2-reallocation-bot](https://github.com/morpho-org/vault-v2-reallocation-bot) from `/morpho` Automation bots (`lib/constants/links.ts`).

## 2026-08-29 — Bots tabs, treasury inflows, Midnight, load times

- Bots `/morpho/bots`: Allocator / Sentinel / Rebater tabs; Safes on by default, EOAs off; Rebater watches treasury outflows (`lib/bots/rebater-activity.ts`). Telegram + muscadine-bots links (`lib/constants/links.ts`).
- Bot activity BFF: `?panel=`, one APY series per vault, Alchemy only for known bot/Safes (`app/api/bots/activity/route.ts`).
- Protocol txs: single `vaultV2transactions` query (`app/api/protocol-transactions/route.ts`).
- Treasury income: GraphQL **daily share change** × that day's USD; self-deposits excluded (`compute-treasury-statement.ts`). No RPC/ABI; not `assetsUsd` mark-to-market. BFFs require HttpOnly session cookie (`proxy.ts`). Vault list is one aliased GraphQL query + 30s cache.
- Markets: All/Blue/Midnight toggle; Midnight REST books (`lib/morpho/midnight-markets.ts`, `GET /api/markets/midnight`); wallet positions card on `/markets`.

## 2026-07-31 — Bot market labels via GraphQL + repos on Morpho Tools

- Bots activity labels markets as `cbBTC/USDC (86%)` via Morpho GraphQL
  (`marketById` / assets lookup) from decoded allocate/deallocate/liquidity calldata.
- Automation bot GitHub links restored on `/morpho`; `/morpho/bots` is activity-only.

## 2026-07-31 — Bots: Allocator + Sentinel boxes, all role holders

- `/morpho/bots`: separate Allocator and Sentinel panels; watches every on-chain
  allocator/sentinel (Bot EOA labeled **Bot**, Safes labeled); decodes
  liquidity-adapter market switches from calldata.

## 2026-07-31 — Top Holders pagination + mobile polish

- Vault overview Holders → **Top Holders**: USD-sorted, 10/page arrows like
  transactions, mobile card rows, larger touch targets.
- Protocol Users drill-down + bots watch: mobile card layouts; fixed nested
  link-in-button a11y on bot activity rows; drop zero/burn addresses from
  protocol users.

## 2026-07-31 — Protocol stats drill-down + Curator Bots page

- Overview Protocol KPIs (TVL / Fees / Users / Active Vaults) are clickable;
  Users shows paginated holders with per-vault token+$ and combined latest txs
  (`/api/protocol-users`, `/api/protocol-transactions`,
  `components/overview/ProtocolStatsDetail.tsx`).
- Curator sidebar **Bots** at `/morpho/bots`: watch allocator/sentinel EOA
  (default `0xf35B…B333`) with allocate/deallocate legs, APY delta, risk note
  (`/api/bots/activity`); automation bot repo links moved here from `/morpho`.

## 2026-07-30 — Overview: collapsible holders / txs / history

- Moved holders + recent txs from Risk Analytics onto Overview Vault State.
- Order under Vault State: Holders → Recent Transactions → History (all
  collapsible, default closed). Holders/txs show 10 per page with bottom
  arrows; History filters visible immediately on expand.
- Risk Analytics is market risk grades only.

## 2026-07-30 — Morpho hub: three automation bots

- `/morpho` Automation bots: Muscadine vault bots, morpho-bots, vault-v2-reallocation-bot
  (`lib/constants/links.ts`).

## 2026-07-28 — Morpho hub: automation bots list

- `/morpho` Automation bots: morpho-bots monorepo first, Muscadine realloc fork second;
  removed standalone liquidation and Morpho realloc bot links.

## 2026-07-28 — Morpho hub: remove StartOS bot link

- `/morpho` Automation bots: removed Muscadine Vault V2 Reallocation Bot (StartOS) entry;
  Muscadine Docker fork link remains.

---

## 2026-07-28 — v1.5.2: token-primary vault + markets display

- Release **1.5.2**: vault overview + markets show token amounts primary, USD secondary.
- Vault tabs: liquidity/history on Overview; Risk Analytics tab; emergency actions on Sentinel.
- Vault catalog (`/vaults`): TVL rows use `TokenUsdValue` + GraphQL `totalAssets`.
- Risk API: reverted extra market `state` fields that exceeded Morpho query complexity.
- Shared `TokenUsdValue` component; Morpho `sizeUsd` / `totalLiquidityUsd` for display columns.

---

## 2026-07-28 — Markets/vault display polish

- Aligned `MarketRiskDetailCard` USD fields with Morpho columns (`sizeUsd`,
  `totalLiquidityUsd`); vault share % still uses `supplyAssetsUsd`.
- Market detail: split total liquidity (USD) vs available liquidity (token + USD).
- `TokenUsdValue`: USD-only primary when no underlying; no fake `$0.00`.
- Docs: §4.2 vault tabs, §4.4 overview metrics, §4.7 token-primary table.

---

## 2026-07-28 — Markets token amounts

- Markets browser + Blue market detail: token amount primary, USD muted secondary
  (`CuratorMarketsBrowser`, `app/market/blue/[id]/page.tsx`, `MarketRiskDetailCard`).
- GraphQL: `supplyAssets`, `borrowAssets`, `collateralAssets`, `liquidityAssets` on list + detail.

---

## 2026-07-28 — Vault overview token amounts

- Overview Metrics (Total Assets / Liquidity / Idle): token amount primary,
  USD muted secondary (`VaultOverviewPanel`).

---

## 2026-07-27 — Mobile shell polish

- AppShell: sticky topbar, `min-w-0` content column, safe-area bottom, clamped
  page descriptions on small screens.
- Account sheet: z-index above sidebar, body scroll lock while open.

---

## 2026-07-27 — Market positions: borrow + summary

- `/markets/positions`: borrow against collateral (`executeBorrowAssets`);
  position card under Blue market alert shows pair + Market/Morpho links,
  LLTV, collateral, debt, supply (`MarketPositionBox`).

---

## 2026-07-27 — Remove middleware + Morpho path aliases

- Deleted `middleware.ts` (legacy `/morpho/create-market` + `/morpho/transact`
  redirects). Use `/markets/create`, `/vaults/transact`, `/markets/positions`.
- Dropped unused `/vaults/:chainId/:address/*` next.config aliases.

---

## 2026-07-27 — Drop unused Morpho `/vaults/:chainId/:address` redirects

- Removed inbound Morpho Curator path aliases from `next.config.ts` (unused;
  catalog is `/vaults`, ops pages are `/vault/[address]/*`).

---

## 2026-07-27 — Vault tab order + tiny realloc + link hover

- Tabs: Overview → Analytics → Allocation → Caps → Timelocks → Sentinel.
- Allocation market links: blue underline on hover.
- Tiny realloc: stop treating sub-display-dp edits as no-ops (USDC was
  effectively blocked below 0.001); exact display match only for unchanged.

---

## 2026-07-27 — Delete legacy morpho routes + bugfixes

- Removed `app/morpho/create-market` and `app/morpho/transact` pages; middleware
  redirects bookmarks (query-aware for market tab).
- Fixed: MarketPositionBox URL load waits for RPC; repay uses max approve + 1%
  buffer; vault Morpho app link uses chain slug.

---

## 2026-07-27 — App IA: top nav + area sidebars

- Topbar: Overview · Vaults · Markets · Curator · Business (`lib/nav/areas.ts`).
- Sidebar is area-scoped (vault tree only under Vaults).
- Routes: `/vaults`, `/vaults/transact`, `/markets/create`, `/markets/positions`.
- Legacy `/morpho/create-market` + `/morpho/transact` redirect/compat.

---

## 2026-07-27 — Blue market position manager + hub polish

- `/morpho/transact`: Vault | Blue market tabs — repay+withdraw collateral, supply,
  withdraw supply (`MarketPositionBox`, `market-bootstrap` exit helpers).
- Create-market keeps one-time dead deposit + seed; links to position manager.
- Morpho Tools hub: same compact row style as External links; Muscadine realloc bot
  forks under Automation bots.

---

## 2026-07-27 — Create-market bootstrap + sidebar

- Dead deposit + optional rate seed stay on `/morpho/create-market` after create
  (`MarketBootstrapPanel`, `lib/morpho/market-bootstrap.ts`).
- Sidebar Curator Tools: Morpho Tools → Morpho Markets → Multisig; denser vault rows.
- TODO Today cleared.

---

## 2026-07-27 — Overview Roles/Adapters density

- Roles & Adapters match Metrics/Fees row cards (no nested boxes / card-table toggle).
- Dropped fee recipient addresses from Roles (already in Fees).
- Files: `VaultV2Roles.tsx`, `VaultV2Adapters.tsx`, `VaultOverviewPanel.tsx`.

---

## 2026-07-27 — Allocation edit Allocated-column jump + dead code

- **Rebalance:** Allocated column / % stay in display-space while planning uses
  booked (`bookedTargetToDisplayInput`); unchanged inputs treat format round-trip
  (USDC 3dp) as no-op. Prefill keeps full display precision.
- **Dust recipient:** still wired (`DustRecipientSelect` → `applyPlanningDust`;
  auto → Idle).
- **Dead code removed:** unused AllocationListView helpers; `maxTargetForRow`,
  `clampPlanToFundableIdle`; `buildUnwrapWalletWethBundle`; `ORACLE_PRICE_SCALE`.

---

## 2026-07-27 — Dep refresh + sharp GHSA-f88m-g3jw-g9cj

- Bumped in-range deps (next/react/viem/recharts/radix/tanstack/…).
- **Held:** wagmi 2 (RainbowKit peer), ESLint 9, TypeScript 6.
- Override `sharp>=0.35.3` (Dependabot #98 / libvips CVEs); Next still optional-deps `^0.34.5`.
- Fixed recharts 3.10 `labelFormatter` ReactNode typing in ChartFees/Inflows/Revenue.

---

## 2026-07-27 — Allocation edit fix + Morpho vault routes + Safe audit

- **Allocation:** Rebalance inputs show display amounts (Allocated column); planning
  maps `booked + (input − display)`. Cancel/Safe-queue clear `inputValues`.
  Files: `VaultV2Allocations.tsx`, CLAUDE §3 display/booked, AGENTS.
- **Routes:** `/vault/[address]/allocation|caps|timelocks|sentinel|analytics` via
  `VaultPageShell`; Morpho `/vaults/:chainId/:address/*` redirects in `next.config.ts`.
- **Safe:** Curator role Safe configured; public catalog listing paused by Safe →
  TODO Later (Custom App works). Manifest description refreshed.
- USDC test vault + Overview/Analytics + `/morpho/transact` from prior session.

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
