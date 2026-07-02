*TO work on today:

- UI glitch with reallocation. Review this set up. I manually make three markets have less allocation to them (eg a market has 5005 USDC than i mark it down to 5000), than with the 15 usdc now i have unallcated, i press max to allocate all of it to a new market. The backend works and it is fully allocated to the other market, but on the UI when I press max, token allocation appears on idle. 
- On the safe multi sigs, any wallet, not just muscadines, can execute a transcaction, so take the safegaurds off when executing a transcaction on the safe multisig wallets. For the signing on transcactions and queues, it is correctly done. But we dont need to have safehaurds for executing a transcaction, it makes the process a little more slower. Review

**To work on another day:

- Email alerts when issues arise with vaults or the markets, so we can quickly react.
- Upgrade risk management calcuations, review the four sectors: Liquidation Headroom, Utilization, Coverage Ratio, Oracle Freshness. Utilization and oracle freshness are needed. Are there better types of variables to manager risk or are those the best options and best parameters? Review for V1 and V2 vaults.
- Register Curator as a public Safe App (custom URL works today via `public/manifest.json` + `NEXT_PUBLIC_APP_URL`).
