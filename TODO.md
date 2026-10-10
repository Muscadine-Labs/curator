# Curator TODO

Running task list for agents and humans. Work **Today** top-to-bottom unless directed otherwise. **Later** is out of scope unless asked. Log finished work under **Done** and in `docs/brain/CHANGELOG.md`.

## Today

## Done

- Claim fees on the fee wrapper tab and on each underlying vault overview. The preview quotes pending performance and management fees; confirm calls `accrueInterest()` from the wallet or queues it in a Safe.
- Midnight browse sorts and filters by filled market size. Pair labels keep the real collateral and drop the loan token and Tenor `-collat` receipts. Detail pages still list every accepted asset and how much is posted.
- `/vaults` lists underlying vaults only. Fee wrappers stay on each vault’s Fee wrapper tab.
- Coinbase and Base Account telemetry is off, and Coinbase uses the connector id AppKit checks so it does not add a second SDK. Expected `kink()` and Chainlink feed misses stay quiet. A kink RPC failure is not cached; a missing `kink()` is. An oracle `price()` revert still logs. An RPC failure on the first feed still reads the other feeds.
- Midnight market page shows filled size (`total_units`), summed lender credit, and summed borrower debt.
- Vault pages use Morpho's frame: vault name, chain, more menu, text tabs, pending count on Timelocks and Sentinel. Overview leads with vault state. Timelocks show pending actions above the delay list.
- Public Allocator caps: allocator can edit idle permission, per-market cap, and allow deallocation on the Caps tab.
- Bundler 3 review: this app makes no Bundler3 calls (the constants were removed earlier). Deposits and withdrawals live in muscadine-onchain, so any migration happens there.
