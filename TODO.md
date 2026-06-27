*TO work on today:
- ~~On allocations for a vault, allocation does not upade to the most recent token amounts since the last allocation.~~ Fixed: on-chain idle overlay uses min(GraphQL, computed) after rebalances; risk route includes position-only markets; post-tx exits edit mode and awaits refetch.
- ~~make a curator/markets~~ Done: `/curator/markets` browser + `/curator/market/blue/[id]` detail with filters, Muscadine cap highlighting, risk card, Morpho app link. Networks: Base (default), Ethereum, Hyperliquid.

**To work on another day:

- Email alerts when issues arise with vaults or the markets, so we can quickly react.
- Upgrade risk management calcuations, review the four sectors: Liquidation Headroom, Utilization, Coverage Ratio, Oracle Freshness. Utilization and oracle freshness are needed. Are there better types of variables to manager risk or are those the best options and best parameters? Review for V1 and V2 vaults.
- Register Curator as a public Safe App (custom URL works today via `public/manifest.json` + `NEXT_PUBLIC_APP_URL`).
