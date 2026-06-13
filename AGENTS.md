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
npm test        # jest
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
- **V1 reallocate** is target-based; withdrawals before deposits; last deposit
  is the `maxUint256` dust catcher (`lib/onchain/reallocation.ts`).
- **V2 allocate/deallocate** is delta-based; idle is never in calldata;
  unallocated remainder defaults to implicit Idle, with an optional explicit
  dust recipient (cap-validated).
- **No server-side private keys** — all writes go through the connected wallet.
- Keep `CLAUDE.md`, `AGENTS.md`, and `TODO.md` in sync with behavior changes.
