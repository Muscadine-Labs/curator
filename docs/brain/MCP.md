# Morpho MCP (live Morpho data)

Part of the brain closed loop. Use this for **live** Morpho GraphQL-backed facts instead of inventing numbers or hand-writing one-off queries.

## Config

Project MCP: [`.cursor/mcp.json`](../../.cursor/mcp.json)

```json
{
  "mcpServers": {
    "morpho": {
      "command": "npx",
      "args": ["-y", "mcp-morpho-server"]
    }
  }
}
```

Server package: [`mcp-morpho-server`](https://github.com/crazyrabbitLTC/mcp-morpho-server) (Morpho GraphQL API).

Enable in Cursor: **Settings → MCP** and ensure the project server is on. Restart agent chat after first add.

## When to use

| Need | Prefer |
|------|--------|
| Live markets / whitelist / APY / oracle details | Morpho MCP tools |
| Live vault state, allocations, reallocates, txs | Morpho MCP tools |
| Account overview / liquidations | Morpho MCP tools |
| Curator app BFF shapes, caps, idData, writes | Repo code + `CLAUDE.md` |
| Oracle feed sanity before `createMarket` | https://oracles.morpho.dev/ (+ MCP `get_oracle_details` if useful) |

## Tools (reference)

**Markets:** `get_markets`, `get_whitelisted_markets`, `get_market_positions`, `get_historical_apy`, `get_oracle_details`  
**Vaults:** `get_vaults`, `get_vault_positions`, `get_vault_transactions`, `get_vault_allocation`, `get_vault_reallocates`, `get_vault_apy_history`  
**Other:** `get_asset_price`, `get_account_overview`, `get_liquidations`

## App GraphQL still matters

Curator BFF uses `lib/morpho/graphql-client.ts` with app-specific field names (`marketId` → `marketKey`, `oracle.address`, complexity limits). MCP is for agent investigation; production UI paths stay on the BFF. See `CLAUDE.md` §4.4.1.
