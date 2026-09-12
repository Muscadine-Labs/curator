# Curator TODO

Running task list for agents and humans. Work **Today** top-to-bottom unless directed otherwise. **Later** is out of scope unless asked. Log finished work under **Done** and in `docs/brain/CHANGELOG.md`.

## Today

## Later

- After Vineyard is deployed: add it to `lib/config/vaults.ts` and whitelist the two adapters on the shared send-assets gate (`muscadine-onchain` CLI).

## Done

- 2026-09-12 — Deleted leftover transact helpers (`blue-create-market`, vault-position API/hooks, Bundler3 constants, unused `@morpho-org/morpho-ts`). Old `/vaults/transact` and `/markets/{create,positions}` URLs redirect to catalog pages.

- 2026-09-12 — Split onchain scripts to private `Muscadine-Labs/muscadine-onchain`. Removed vault deposit/withdraw and Blue market create/positions UIs from this dashboard. Kept allocation, sentinel, roles, gates, Safe, and market browse.

- 2026-09-12 — Pre-prod review: gate import decode, MultiSend serviceSynced/DelegateCall guards, import preview sanitize, Upstash login rate limits, production session secret.
