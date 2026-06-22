*TO work on today:
- [ ] Add V1→V2 fee migration tx hashes to `TREASURY_MISC_EXCLUDED_TX_HASHES` in `lib/morpho/treasury-statement.ts` when known. Also, Revenue on overview is incorrect.
- [ ] Deallocate to Idle on sentinel does not work. It should be amount and I can press zero (not max) and itll go to idle liqudity. I dont even know what your directions even mean on that. For this function research on morpho docs and specs on how to do it. 
- [ ] Decrease Caps on sentinel do not work, have also for sentinel a clear function. For this function research on morpho docs and specs on how to do it. 
- [ ] Vault Pending Actions on sentinel be able to stop these actions. For this function research on morpho docs and specs on how to do it.
- [ ] On Allocations, when I press max to reallocate, transcaction fails. Also, remeber for max or zero to include all zeros/decimals of the asset. For this function research on morpho docs and specs on how to do it.
- [ ] On Allocation, the defult dust recenpeant should be the liquidty adaptor (or market). Please make sure your work is correct. 

///
- [x] Run lint, build and test
- Bump version to 1.0.9 on next GitHub push (currently 1.0.8)


**To work on another day:

- Email alarts when issues arise with vaults or the markets, so we can quickly react.
- intergrate the safe multi sig, you can use sdks, find the best way to impliment it. Either sdks, morpho sdks, abis ect.
- Upgrade risk management calcuations, review the four sectors: Liquidation Headroom, Utilization, Coverage Ratio, Oracle Freshness. Utilization and oracle freshness are needed. Are there better types of variables to manager risk or are those the best options and best parameters? Review for V1 and V2 vaults.
- Make this website a safe app i can use for my multi sigs - https://github.com/safe-global/safe-apps-sdk
