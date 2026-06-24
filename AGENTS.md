# AGENTS.md — Working Instructions for AI Assistants

This file is the quick-start contract for any AI agent working in this repo.
The full architecture reference lives in **`CLAUDE.md`** — read it before
touching vault mechanics, allocations, Morpho GraphQL queries, or formatting.

## Session checklist

1. **Read `TODO.md` first.** It is the running task list for the repo. Work the
   "TO work on today" section top-to-bottom unless directed otherwise. Items
   under "To work on another day" are out of scope unless explicitly requested.
2. **Read the relevant sections of `CLAUDE.md`** (especially §3 vault mental
   model and §5 reallocation UX conventions) before changing allocation logic.
3. After substantive changes, run and pass:

```bash
npm run lint    # eslint . --max-warnings=0
npm run build   # next build
```

## Key invariants (do not regress)

- **Auth:** the only login username is `admin` (role `'admin'`); password from
  `CURATOR_ADMIN_PASSWORD` (legacy `CURATOR_OWNER_PASSWORD` accepted).
- **V2-only vault config:** all tracked vaults are Morpho V2 (`lib/config/vaults.ts`).
  Detail pages and on-chain writes use `app/vault/v2/[address]/page.tsx` only.
- **React Query polling** — dashboard hooks poll every 30s; indexed vault data
  (history, reallocations, holders) does not background-poll. On-chain vault
  hooks (`risk`, `governance`) use `staleTime: 0` + `refetchOnMount: 'always'`.
  See `lib/data/query-config.ts`.
- **V2 allocate/deallocate** is delta-based; idle is never in calldata;
  unallocated remainder defaults to implicit Idle, with an optional explicit
  dust recipient (cap-validated).
- **V2 cap `idData` ≠ deallocate `data`:** cap writes use prefixed ABI encoding
  (`"this"`, `"collateralToken"`, `"this/marketParams"`) via `lib/morpho/v2-id-data.ts`;
  deallocate/allocate adapter `data` is `abi.encode(marketParams)` for Blue markets
  or `0x` for MetaMorpho. Never pass bare addresses or raw MarketParams as cap
  `idData`.
- **V2 vault tabs** (Morpho Curator order): Overview → Roles → Adapters → Caps →
  Timelocks → Allocation → Sentinel → Emergency. Pending actions embed in Caps;
  Sentinel is the only tab with sentinel writes (decrease caps, deallocate).
- **Tx preview** — Allocation and Sentinel confirm writes through
  `TxPreviewDialog` + `lib/morpho/tx-preview.ts` before the wallet signs.
- **V2 pending revoke** — per-row `rowId` + `activeRowId`; never key tx state by
  `item.data` alone (batched pending actions can share calldata).
- **V2 cap labels / idData** — governance `marketParams` + `fetch-markets-by-id.ts`
  enrichment for zero-allocation market and collateral caps.
- **Allocation freshness** — **Rebalance** refetches `vault-v2-risk` +
  `vault-v2-governance` before edit mode; tx preview still re-reads chain via
  `finalizeRebalancePlan`. Risk/governance BFF routes use `no-store` (no CDN cache).
- **Governance query key** — use `vaultV2GovernanceQueryKey(address)` from
  `useVaultV2Governance.ts` for all `refetchQueries` / invalidations (suffix
  `'caps-state-v2'`).
- **Client data freshness** — hooks use `apiFetch` (`cache: 'no-store'`);
  `CURATOR_REFETCH_INTERVAL_MS` and default `staleTime` are **30s** (capped via
  `API_CACHE_MAX_AGE_MS` in `lib/api/response-cache.ts`).
- **No server-side private keys** — all writes go through the connected wallet.
- Keep `CLAUDE.md`, `AGENTS.md`, and `TODO.md` in sync with behavior changes.
