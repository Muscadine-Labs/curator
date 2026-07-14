# Muscadine Curator — Brain (closed loop)

Single entry for AI sessions. Deep architecture stays in **`CLAUDE.md`**. This folder is the **loop**: what to read, what to update, what live tools to use.

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│  TODO.md    │────▶│  Code + MCP  │────▶│  Log + docs     │
│  (intent)   │     │  (execute)   │     │  (memory)       │
└─────────────┘     └──────────────┘     └────────┬────────┘
       ▲                                          │
       └──────────────────────────────────────────┘
```

## Session loop (do every time)

1. **Read** `TODO.md` → Today (top → bottom). Skip Later unless asked.
2. **Load context** — this file + relevant `CLAUDE.md` sections (see map below). Invariants: `AGENTS.md`.
3. **Use Morpho MCP** when the task needs live Morpho data (markets, vaults, APY, oracles, liquidations) instead of guessing or pasting GraphQL by hand. See [`MCP.md`](./MCP.md).
4. **Implement** — match existing patterns; no server private keys; wallet writes only.
5. **Close the loop** before ending:
   - Mark items in `TODO.md` (move to Done or check off).
   - Append `docs/brain/CHANGELOG.md`.
   - Update `AGENTS.md` / `CLAUDE.md` if behavior or routes changed.
   - Run `npm run lint` (and `npm run build` before push).

## Doc map (who owns what)

| Doc | Role | Edit when |
|-----|------|-----------|
| **`TODO.md`** | Intent queue | Starting/finishing work |
| **`docs/brain/`** | Closed-loop hub + changelog + MCP | Every substantive session |
| **`AGENTS.md`** | Short invariants contract | Routes, auth, write rules, polling |
| **`CLAUDE.md`** | Deep architecture | Vault mechanics, GraphQL, Safe, formatting |
| **`.cursor/rules/*.mdc`** | Always-on Cursor rules | Session protocol changes |
| **`.cursor/mcp.json`** | Morpho MCP wiring | MCP server / tools change |

## CLAUDE.md section map (don't load all at once)

| Topic | Section |
|-------|---------|
| Working agreements / env | §0 |
| Layout / routes | §2 |
| V1 vs V2 vault model | §3 |
| Allocation data flow | §4 |
| Reallocation UX | §5 |
| Number formatting | §6 |
| On-chain writes | §7 |
| Auth | §9 |
| Pitfalls | §10 |
| Multisig Safe | §13 |
| CCTP | §14 |
| Theme / density | §16 |
| Create Blue market | §18 |

## Related repos

- **Scripts (deploy markets/oracles):** `~/Desktop/morpho-markets-scripts` — source of truth for MarketPlans / feeds; curator UI mirrors `createMarket` at `/morpho/create-market`.
- **Oracle validation:** https://oracles.morpho.dev/

## Refactor status

Brain hub + Morpho MCP + session rule are **in use** (closed loop). Optional next: thin `AGENTS.md` further; split oversized `CLAUDE.md` chapters into `docs/brain/topics/` only when a section is edited often (avoid big-bang rewrite) — tracked under Later in `TODO.md`.
