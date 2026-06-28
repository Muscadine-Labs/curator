*TO work on today:
- Glitch where when I re-allocate, I sign with my wallet for the safe mutlitsig on the allocation / sentinal page, than i sign again on the safe page, than I push transcaction through, it should be i confirm the transcaction on the allocate / sentinal page, than i sign on the multisig safe page than transcact. I sign twice, it should be once, review the work.
- Also for the reallcate page, when I reallocate there are still minor bugs with Zero and Max, review all of the codebase for every situation that can happen on allocation page.


**To work on another day:

-- For the caps, have the ability to accept the new caps and push the accept transcaction to the multisgi safe page. Research which safe can do this, i think allocator can accept all caps, but on the review model have the option to select which safe to push it to (allocator being defult).
- Email alerts when issues arise with vaults or the markets, so we can quickly react.
- Upgrade risk management calcuations, review the four sectors: Liquidation Headroom, Utilization, Coverage Ratio, Oracle Freshness. Utilization and oracle freshness are needed. Are there better types of variables to manager risk or are those the best options and best parameters? Review for V1 and V2 vaults.
- Register Curator as a public Safe App (custom URL works today via `public/manifest.json` + `NEXT_PUBLIC_APP_URL`).
