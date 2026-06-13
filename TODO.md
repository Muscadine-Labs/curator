*TO work on today:

- [x] Update the dependencies in packages, note no wagmi 3.x is able as of now.
      (all deps updated within semver; wagmi stays on 2.x)
- [x] change the username from owner to admin. We can just have admin, no other
      usernames should exist. (role is now 'admin'; env: CURATOR_ADMIN_PASSWORD,
      legacy CURATOR_OWNER_PASSWORD still accepted)
- [x] on the Total tokens supplied graph for each vault, change the name to TVL
      because thats what it is.
- [x] On the vault pages for the graphs of TVL, price per token and apy, the
      price per token was incorrect on y-axis for bitcoin vaults — fixed with
      adaptive tick precision based on the zoomed domain span.
- [x] On V2 allocations, extra dust/remainder can now be routed to a chosen
      market/adapter via the Dust recipient selector; defaults to Idle when
      nothing is picked. Explicit recipient is still cap-validated.
- [x] Liquidation LTV display: kept at 2 decimals everywhere (pill included).
- [x] Delisted markets (zero allocation + no active cap) are hidden from V2
      allocations (wstETH/WETH case on Muscadine WETH Prime). Markets with 0
      allocation but a live cap remain visible. Same rule applied to V1
      (supply cap exactly 0 = delisted).
- [x] Reviewed V1 + V2 reallocation logic. Bugs found and fixed:
      - V1 cap validation skipped markets with supply cap 0 (truthiness bug) —
        a delisted market could pass validation.
      - V2 single-call path could select the idle row; idle-only edits no
        longer count as a submittable change.

///
- [x] Run lint, build and test to make sure everything is functional
- [x] Bump the repo version by 0.0.1 each time we push to github. Once its at 9,
      you pump it to 0 and the next decimal up. Such as 0.2.9 to 0.3.0 and 1.9.9
      to 2.0.0. (rule documented in CLAUDE.md §0 and AGENTS.md; now at 1.0.8)
- [x] On CLAUDE.md and AGENTS.md add information to review the TODO.md.


**To work on another day:

- Email alarts when issues arise with vaults or the markets, so we can quickly react.
- intergrate the safe multi sig, you can use sdks, find the best way to impliment it. Either sdks, morpho sdks, abis ect.
- Upgrade risk management calcuations, review the four sectors: Liquidation Headroom, Utilization, Coverage Ratio, Oracle Freshness. Utilization and oracle freshness are needed. Are there better types of variables to manager risk or are those the best options and best parameters? Review for V1 and V2 vaults.
