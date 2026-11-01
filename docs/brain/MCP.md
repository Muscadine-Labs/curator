# Morpho MCP (live Morpho data)

Part of the brain closed loop. Use Morpho's hosted MCP for **live** vault, Blue market, and Midnight facts instead of inventing numbers. It is a public server: no Muscadine account, no API key.

Official reference: https://docs.morpho.org/developers/agents/mcp/

The server is experimental and pre-v1.0. Tool names and schemas can change. Do not build the app against it. Production UI paths stay on the BFF.

## Config

| Client | File |
|--------|------|
| Cursor | [`.cursor/mcp.json`](../../.cursor/mcp.json) |
| Claude Code | [`.mcp.json`](../../.mcp.json) |

```json
{
  "mcpServers": {
    "morpho": {
      "type": "http",
      "url": "https://mcp.morpho.org/"
    }
  }
}
```

| | |
| --- | --- |
| Endpoint | `https://mcp.morpho.org/` |
| Transport | Streamable HTTP |
| Authentication | None |
| Server name | `morpho-mcp` |

Enable the project server in Cursor (**Settings → MCP**) and restart the agent chat after the first add. The server never signs and never broadcasts.

## Conventions

- Vault tools and vault prepare tools take `vault-selector` as `chainId:address` (example `8453:0xbeef…`).
- Blue market tools take `market-selector` as `chainId:marketId`. Midnight tools take `market-id` with no chain id.
- Amounts are integer strings in base units. Read decimals from the tool response.
- List tools are paginated. Pass `cursor` back until it is `null`.
- Find a target with a list tool, then read it with the matching get tool. Do not hardcode an address you have not just read.

## When to use

| Need | Prefer |
|------|--------|
| Live vault, Blue market, Midnight book, or a user's positions | Morpho MCP |
| Curator app BFF shapes, caps, idData, writes | Repo code + `CLAUDE.md` |
| Oracle feed sanity before a market is created | https://oracles.morpho.dev/ |
| Signing or sending a transaction | The app wallet flow. Ignore `morpho_prepare_*` payloads |

`morpho_prepare_*` returns unsigned calls. This dashboard does not submit them.

## Tools

Read tools come from Morpho's Core REST, Vaults App, and Markets APIs. Groups: general (`morpho_get_supported_chains`, `morpho_get_token_balance`, `morpho_doc_search`), vaults, Blue markets, Midnight books and positions, and prepare tools. The current list is on the docs page above. This server does not expose the old community GraphQL tools (`get_oracle_details`, `get_vault_reallocates`, `get_liquidations`, `get_account_overview`).

## App GraphQL still matters

The curator BFF uses `lib/morpho/graphql-client.ts` with app-specific field names (`marketId` → `marketKey`, `oracle.address`, complexity limits). MCP is for agent investigation. See `CLAUDE.md` §4.4.1.
