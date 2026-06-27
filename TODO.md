*TO work on today:
- On allocations for a vault, allocation does not upade to the most recent token amounts since the last allocation. See why that is, and if morpho ql would be better to show on ui and correct amount.
make curator/markets as a way I can find new markets. make filters and have these as defaults for each market. first would be netwrok, collaleral, loan, LLTV, total market size, total liquidity, 6H APY (net rate), Than add if the market is listed or not. If a muscadine vault is inabled to lend to a market, make the whole market row a diferent color. So than for markets if I tap on it, should be /curator/market/blue/marketaddress than when midnight comes out it would be /curator/market/midnight/marketaddress. For the marekt pages have the same info and if muscadine lends to it. Than include all of the rik parameters on our risk page to the market, and link it to morpho front end such as "https://app.morpho.org/base/market/0x9103c3b4e834476c9a62ea009ba2c884ee42e94e6e314a26f04d312434191836". For networks, include base as defualt, have the ability to switch to ethereum and hyperliquid also. Remeber that at the top we have network connected to rainbow. 

**To work on another day:

- Email alerts when issues arise with vaults or the markets, so we can quickly react.
- Upgrade risk management calcuations, review the four sectors: Liquidation Headroom, Utilization, Coverage Ratio, Oracle Freshness. Utilization and oracle freshness are needed. Are there better types of variables to manager risk or are those the best options and best parameters? Review for V1 and V2 vaults.
- Register Curator as a public Safe App (custom URL works today via `public/manifest.json` + `NEXT_PUBLIC_APP_URL`).
