*TO work on today:

- UI glitch with reallocation. Review this set up. I manually make three markets have less allocation to them (eg a market has 5005 USDC than i mark it down to 5000), than with the 15 usdc now i have unallcated, i press max to allocate all of it to a new market. The backend works and it is fully allocated to the other market, but on the UI when I press max, token allocation appears on idle. 
- On the safe multi sigs /safe, any wallet, not just muscadines, can execute a transcaction, so take the safegaurds off when executing a transcaction on the safe multisig wallets. For the signing on transcactions and queues, it is correctly done. But we dont need to have safehaurds for executing a transcaction, it makes the process a little more slower. Review
- On network for /market add robinhood chain, make sure its on the top for wallet also. They should all be the same for chains. Base, Ethereum, hyperevm, robinhood, polygon only. On /markets have it so it mirrors the top bar network toggle, i dont want to be able to switch it on /marekts but on the top bar. 
- On allocations instead of Zero, put Min, which could be 0, but the button min should be the minimum allocation witht he avaliable liquidity. 
- on /markets have each stat that has $ amount to also have total token amount.
- on the vault overview pages for transcactions and token holders, for Assets amount in tokens for weth and cbbtc have it in 6 decimals not 4, and usdc in 3 decimals not 2.
- On the revenue, and revenue graph, how is it calucalated per month and also why on the grapgh are some values negative? when i never withdrew anything, i think its based off the assets price. Also, does it support and get info from assets held in the wallet and all v2 vaults?

- 
**To work on another day:

- Email alerts when issues arise with vaults or the markets, so we can quickly react.
- Upgrade risk management calcuations, review the four sectors: Liquidation Headroom, Utilization, Coverage Ratio, Oracle Freshness. Utilization and oracle freshness are needed. Are there better types of variables to manager risk or are those the best options and best parameters? Review for V1 and V2 vaults.
- Register Curator as a public Safe App (custom URL works today via `public/manifest.json` + `NEXT_PUBLIC_APP_URL`).

  
What is known: this repo handles abi functions for the roles of "allocator" and sentinal". No function of curator or owner is set up for the vaults.
