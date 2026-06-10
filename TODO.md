*TO work on today:

- Update the dependencies in packages, note no wagmi 3.x is able as of now.
- change the username from owner to admin. We can just have admin, no other usernames should exist.
- on the Total tokens supplied grapgh for each vault, chnage the name to TVL becuse thats what it is. 
- On V2 allocations, is there a way where there is extra dust left over that would go to the idle allocation, that I can pick what markets/adapter the extra would go to, it still can go to indle if i dont pick anything.
- On the v2 allocation, there was a market a thought i deallocated and delisted on the Muscadine WETH Prime vault v2 on base, wstETH / WETH
97%
Util.
33.93%
Liquidity
$2.95
Supply
0.02%
Allocated
0.000000000000000000 WETH
0.000000000000000000 WETH. It is still showing up on the ui and I am wondering the mehcanisms of the vaults if they are delisted, on the morpho ui it does not show this market but on our ui it does. 
- Also on allocations, for both v1 and v2, review if everything is correct with reallocations, and there is no bugs to correctly serve its purpose.

///
- Run lint, build and test to make sure everything is functional 
- Bump the repo version by 0.0.1 each time we push to github. Once its at 9, you pump it to 0 and the next decimal up. Such as 0.2.9 to 0.3.0 and 1.9.9 to 2.0.0.
- On CLAUDE.md and AGENTS.md add information to review the TODO.md. Put your new knowledge in the files.


**To work on another day:

- Email alarts when issues arise with vaults or the markets, so we can quickly react.
- intergrate the safe multi sig, you can use sdks, find the best way to impliment it. Either sdks, morpho sdks, abis ect. 
- Upgrade risk management calcuations, review the four sectors: Liquidation Headroom, Utilization, Coverage Ratio, Oracle Freshness. Utilization and oracle freshness are needed. Are there better types of variables to manager risk or are those the best options and best parameters? Review for V1 and V2 vaults.
