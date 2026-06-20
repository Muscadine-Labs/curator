*TO work on today:
- Delete the files for the ability to change vault perameters like in Roles, adaptors, Caps, Parameters, timelocks, pending, queues. We dont need them, and they dont work. Keep all of the function in Allocation because they work. Review your work and allocation for V1 and V2.
- On constants I will be adding more V2 vaults on base, this time they would be Base Frontier vaults, create the pathway for me to access before I impliment.
- Review Net APY 4.74%, Base 4.72%. This doesnt seem right because net apy is after a preformance fee, see if your uploades from morpho sdk/grapghql are correct or the same type. 
- For "Recent Transactions" on the vault pages, include the transcaction address/hash or whatever its named to basescan. (Etherscan if on ethereum). For a "Transfer", fetching the amount transfer does not load, and for every transcaction the usd value does not load.
- standardize on allocations Util, Liquidity, Supply, Allocated, Eff. cap, Allocation as defult, while also making it look better because each row has its columns in diferent sections. Also for v2 vaults "% cap" does nto fetch correctly, while v1 vaults do not have this option at all (only a v2 function, which doesnt work on v2).
- Make the graphs on each vault page a little neater, y axis is lowk trash. keep the defult for All for time, not 30d.
- on overview for revenue, Total Revenue $250.29 From Vaults $154.95 Miscellaneous $63.61. So these numbers do not add up, your total revenue is incorrect.
- on dashbaord, you can mark on constancts that the v1 vaults and v2 testing vaults are not active, hould reduce users and active vaults. Users 29 Active Vaults 6
- Make this website a safe app i can use for my multi sigs - https://github.com/safe-global/safe-apps-sdk


///
-  Run lint, build and test to make sure everything is functional
-  Bump the repo version by 0.0.1 each time we push to github. Once its at 9,
      you pump it to 0 and the next decimal up. Such as 0.2.9 to 0.3.0 and 1.9.9
      to 2.0.0. (rule documented in CLAUDE.md §0 and AGENTS.md; now at 1.0.8)
-  On CLAUDE.md and AGENTS.md add information to review the TODO.md.


**To work on another day:

- Email alarts when issues arise with vaults or the markets, so we can quickly react.
- intergrate the safe multi sig, you can use sdks, find the best way to impliment it. Either sdks, morpho sdks, abis ect.
- Upgrade risk management calcuations, review the four sectors: Liquidation Headroom, Utilization, Coverage Ratio, Oracle Freshness. Utilization and oracle freshness are needed. Are there better types of variables to manager risk or are those the best options and best parameters? Review for V1 and V2 vaults.
