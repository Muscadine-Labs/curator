*TO work on today:
- [x] Revenue on overview: per-vault fees now subtract treasury capital inflows (not gross deposits). Add V1→V2 migration tx hashes to `TREASURY_MISC_EXCLUDED_TX_HASHES` when known.
- [x] Sentinel deallocate: per-row amount + Zero out (full precision) + Deallocate.
- [x] Sentinel decrease caps: per-row Decrease, 0 preset, Clear (both caps → 0).
- [x] Sentinel pending: Revoke button (`vault.revoke`).
- [x] Allocation Max uses full chain decimals; deallocate uses exact `current` when target is 0.
- [x] Default dust recipient = liquidity adapter from governance.

///
- [x] Run lint, build and test. Review all work.


**To work on another day:

- Email alarts when issues arise with vaults or the markets, so we can quickly react.
- intergrate the safe multi sig, you can use sdks, find the best way to impliment it. Either sdks, morpho sdks, abis ect.
- Upgrade risk management calcuations, review the four sectors: Liquidation Headroom, Utilization, Coverage Ratio, Oracle Freshness. Utilization and oracle freshness are needed. Are there better types of variables to manager risk or are those the best options and best parameters? Review for V1 and V2 vaults.
- Make this website a safe app i can use for my multi sigs - https://github.com/safe-global/safe-apps-sdk
