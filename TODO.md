*TO work on today:
- [ ] Add V1→V2 fee migration tx hashes to `TREASURY_MISC_EXCLUDED_TX_HASHES` in `lib/morpho/treasury-statement.ts` when known

///
- [x] Run lint, build and test
- Bump version to 1.0.9 on next GitHub push (currently 1.0.8)


**To work on another day:

- Email alarts when issues arise with vaults or the markets, so we can quickly react.
- intergrate the safe multi sig, you can use sdks, find the best way to impliment it. Either sdks, morpho sdks, abis ect.
- Upgrade risk management calcuations, review the four sectors: Liquidation Headroom, Utilization, Coverage Ratio, Oracle Freshness. Utilization and oracle freshness are needed. Are there better types of variables to manager risk or are those the best options and best parameters? Review for V1 and V2 vaults.
- Make this website a safe app i can use for my multi sigs - https://github.com/safe-global/safe-apps-sdk
