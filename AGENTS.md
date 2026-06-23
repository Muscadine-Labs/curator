# AGENTS.md — Working Instructions for AI Assistants

_Current app version: **1.1.7** (`package.json`)._

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

## Versioning rule (every GitHub push)

Bump `package.json` `version` by **0.0.1 on each push**. When the last digit
would pass 9, roll over to the next decimal:

- `0.2.9` → `0.3.0`
- `1.9.9` → `2.0.0`

## Key invariants (do not regress)

- **Auth:** the only login username is `admin` (role `'admin'`); password from
  `CURATOR_ADMIN_PASSWORD` (legacy `CURATOR_OWNER_PASSWORD` accepted).
- **V2-only vault UI:** detail pages and on-chain writes are V2 only
  (`app/vault/v2/[address]/page.tsx`). V1 vaults still appear in list/stats APIs
  for reporting; manage V1 positions via Morpho Curator / app links.
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
- **Client data freshness** — hooks use `apiFetch` (`cache: 'no-store'`) and
  `CURATOR_REFETCH_INTERVAL_MS` (30s) from `lib/data/query-config.ts`.
- **No server-side private keys** — all writes go through the connected wallet.
- Keep `CLAUDE.md`, `AGENTS.md`, and `TODO.md` in sync with behavior changes.
