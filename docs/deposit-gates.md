# Deposit gates (send assets)

Morpho Vault V2 **send-assets gates** restrict who may call `deposit` / `mint`. Muscadine uses Morpho’s [`WhitelistSendAssetsGate`](https://github.com/morpho-org/vault-v2/tree/main/src/periphery/gates) ([concepts](https://docs.morpho.org/curate/concepts/gates/)).

Config: `lib/config/deposit-gates.ts`  
Calldata / propose: https://github.com/Muscadine-Labs/muscadine-onchain (`npx tsx src/cli.ts gate …`)

```bash
npx tsx src/cli.ts gate set-whitelisted --account 0x… --via safe:allocator
```

## Strategy vaults

The four production strategy vaults use the shared send-assets gate. Deposits are limited to accounts the gate has allowlisted.

| What | On-chain gate? |
| ---- | -------------- |
| Direct deposits into a strategy vault | **Yes** — the sender must be allowlisted |
| Allocate from a strategy vault into a Morpho market | The vault's own adapters; not a depositor allowlist entry |

### Who is allowlisted

The curator gate page does not keep a depositor address list. With `NEXT_PUBLIC_SAFE_API_KEY` it reads the executed history of the Curator Safe and the Allocator Safe, newest first, and decodes `setIsWhitelisted`, `setIsWhitelister`, and `multicall` when `to` is the gate. It stops at the checkpoint in `lib/morpho/send-assets-gate-history.ts`, then reads `isWhitelisted()` / `isWhitelister()` for each account. A missing hash makes that Safe's history get read in full. Blockscout's free tier no longer includes Base, so that key is only a paid fallback. A wallet is shown only after a Safe call names it. An address that is still allowlisted on-chain and has no Basename shows as its full address. Removing an address from `muscadine-onchain` `gateAllowlist()` does not revoke it; that takes `setIsWhitelisted(false)`.

## Whitelist history checkpoint

Recorded **2026-10-31T23:34:51Z**. The gate page reads newer Safe transactions until these, then reuses the accounts already stored.

| Safe | Nonce | Transaction |
| ---- | ----- | ----------- |
| Curator | 224 | `0x56e720c3e30cb0f90e32e96ba8f34573ca5b219e7f916fb232b485a569f5619c` |
| Allocator | 148 | `0x6a8af91c8a60aef5e681bf587a6dace3608f4c9fbb3fc45d3c2e5a2ff6fceb8e` |

Advance `lib/morpho/send-assets-gate-history.ts` when those are no longer the newest executed transactions.

Display names, when the gate returns that address: `nwlutkoski.base.eth`, `muscadine.base.eth`, `nickwc.base.eth`, `ignitis.base.eth`, and **Muscadine Treasury**. Any other whitelisted account shows its Basename, or the full address when it has none.

A wallet the gate has allowlisted can **deposit into a strategy vault directly**.

### Vaults that receive `setSendAssetsGate` (4 addresses)

| Underlying vault | Address |
| ---------------- | ------- |
| Muscadine USDC Prime | `0x89712980Cb434eF5aE4AB29349419eb976B0b496` |
| Muscadine USDC Frontier | `0x314fD07319ef645bA7D548915CCd91F4788A1839` |
| Muscadine WETH Prime | `0xd6dcad2f7da91fbb27bda471540d9770c97a5a43` |
| Muscadine cbBTC Prime | `0x99dcd0d75822ba398f13b2a8852b07c7e137ec70` |

## Rollout (no gate deploy in this repo)

1. Deploy `WhitelistSendAssetsGate(roleSetter = Curator Safe)` externally on Base.
2. muscadine-onchain `gate whitelist-config` → gate `multicall` to appoint whitelisters + allowlist depositors.
3. Curator Safe: `vault.submit(setSendAssetsGate(gate))` on **each of the four underlying vaults** (7d timelock each) via muscadine-onchain `gate submit-send-assets-gate`.
4. After timelock: accept with the same calldata (Curator Pending tab or muscadine-onchain `vault accept`).

Gate `multicall` must first call `setIsWhitelister` for **Curator Safe** and **Allocator Safe** (`0x2Ed45BB3542d06d81D117acd8A561e910A17A618`), then `setIsWhitelisted` for each depositor sender. Either whitelister can later add/remove allowlist entries; only **roleSetter** (Curator Safe) can appoint or revoke whitelisters.

Production gate deployed from Morpho [`vault-v2` `main`](https://github.com/morpho-org/vault-v2/tree/main/src/periphery/gates) **2026-09-05**: `0xb7f2598ac79a3c6406dddb81edcc60ea72a134b9` ([Basescan](https://basescan.org/address/0xb7f2598ac79a3c6406dddb81edcc60ea72a134b9)). Appoint whitelisters: `npx tsx src/cli.ts gate set-whitelister --account 0x…`.

## App UI (app.muscadine.xyz)

The **app does not call gate RPC** (`sendAssetsGate`, `canSendAssets`, or gate `isWhitelisted`). Underlying deposit visibility uses:

| Source | File |
| ------ | ---- |
| Depositor EOAs | The app still has its own copy. Curator no longer keeps that list; it reads the gate. |

Gate UI is **always active** in the app (config allowlist only; no env toggle, no gate RPC).

After **any** allowlist or gate change:

1. Curator picks up gate membership from chain. Update `src/app/src/lib/deposit-gate-config.ts` only if the app's own copy should change.
2. **`npx tsx src/cli.ts gate verify`** in muscadine-onchain — RPC read-only; must pass before shipping app config.
3. Redeploy app when depositor list or gate-active flag changes.

Optional backlog: revert app to live `canSendAssets` RPC — see `src/app/TODO.md`.

## On-chain verification (muscadine-onchain)

```bash
# After allowlist edits, timelock accepts, or before app deploy
npx tsx src/cli.ts gate verify
```

Checks:

- Each underlying vault `sendAssetsGate()` equals the configured gate (non-zero).
- Gate `isWhitelisted(address)` for the addresses in muscadine-onchain `src/config/gates.ts`.

Uses `ALCHEMY_API_KEY` when set; otherwise public Base RPC. Exit code **1** on any mismatch.

## Deallocations and force deallocate (unchanged)

We only set **`sendAssetsGate`**. Other gates stay at `0x0`.

| Operation | Blocked? |
| --------- | -------- |
| Curator **`deallocate`** | **No** |
| User **`withdraw` / `redeem` / `forceDeallocate`** | **No** |

## Operational caveats

### Direct underlying for partners

Any account the gate has whitelisted can deposit the underlying vault directly.

### Whitelist ≠ token custody

A whitelisted `msg.sender` can deposit tokens owned by another address. The gate controls **who initiates** the deposit.
