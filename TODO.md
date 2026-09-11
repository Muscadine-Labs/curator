# Curator TODO

Running task list for agents and humans. Work **Today** top-to-bottom unless directed otherwise. **Later** is out of scope unless asked. Log finished work under **Done** and in `docs/brain/CHANGELOG.md`.

## Today

- Create scripts to make a new v2 vault that has two adaptors that deposits into two morpho v2 vaults (muscadine USDC prime and frontier) The roles should be set all the same how muscadine USDC prime is, with owner, curator, allocator, sentinal and all the timelocks. The only difference is that it would not be apar of the morpho regristry so that would not be abicated. In the script to create the v2 vault, have a readme.md of every vault value before its deployed. The name would be Muscadine USDC Vinyard on base, mvUSDC

- on business, Gross Protocol Revenue. Cost of Revenue Yields are distributed to vaults depositors/investors. total Revenue is wrong from defi lamma when cost of revenue is 0/
- Find any errors from this branches commits, it was made from a bad model, revue using a few subagents. Make sure everything on curator for safe wallets correctly works. Also, review the allocator and sentinal pages for the read and write functions.
- delete pologon from chain list.
- -delete wyoming off of business
- have the ability to interact with the send assets gate, its controlled by out safe multi sig allocator and owner(or curator i forgot) Add the address on the vault pages, than on /curator have a page where i can interact with it (if multiple than i can interact with multiple, as of now there is only one gate for all of the vaults. 

- Delete on https://curator.muscadine.xyz/muscadine-frontends namesilio and add cloudfare.
  (Registrar/DNS change — needs Namesilo + Cloudflare account access, not a code change.)

- Safe: executed-transaction **history** tab (Transaction Service `getAllTransactions`,
  on-demand only — the free tier is 5 req/s / 50K per month).
- Safe: address book for recipients, and a read-only Settings tab (modules, guards).
- Safe: batch several queued proposals into one `MultiSend`.

## Done

- **Auth rate-limit bypass** — `POST /api/auth/verify` keyed its bucket off the
  client-supplied `x-forwarded-for`, so rotating the header gave a fresh
  10-attempt bucket per request and allowed unbounded password guessing.
  Fixed in `lib/utils/rate-limit.ts` (`resolveClientIp` only trusts a forwarded
  IP when `CURATOR_TRUSTED_PROXY_HOPS` — or Vercel — says how many proxies are
  in front) plus a failures-only global backstop. Verified against the running
  app: rotated IPs now 429 at attempt 11.
- **Safe multisig** — Assets / Send / Receive, `app.safe.global`-style
  Home/Assets/Transactions tabs, transfers to and from a Safe, and RPC
  optimizations. See `docs/brain/CHANGELOG.md` 2026-09-08.
