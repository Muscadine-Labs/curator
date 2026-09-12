# Deposit gates (send assets)

Morpho Vault V2 **send-assets gates** restrict who may call `deposit` / `mint`. Muscadine uses Morpho’s [`WhitelistSendAssetsGate`](https://github.com/morpho-org/vault-v2/tree/main/src/periphery/gates) ([concepts](https://docs.morpho.org/curate/concepts/gates/)).

Config: `lib/config/deposit-gates.ts`  
Calldata / propose: https://github.com/Muscadine-Labs/muscadine-onchain (`npx tsx src/cli.ts gate …`)

```bash
npx tsx src/cli.ts gate set-whitelisted --account 0x… --via safe:allocator
```

## Underlying-only rollout

We gate **only the four production underlying strategy vaults**. Fee-wrapper vaults stay at `sendAssetsGate = 0x0` (open).

| What | On-chain gate? |
| ---- | -------------- |
| Block **direct** public deposits into underlying | **Yes** |
| Wrapper TVL → underlying via allocate | **Yes** — adapters whitelisted |
| **Wrapper** deposits from random wallets | **No** — wrappers stay open |

When the wrapper allocates, the **MorphoVaultV2Adapter** calls `deposit` on the underlying vault — **`msg.sender` is the adapter**.

### Gate whitelist (9 addresses)

**Adapters (4)**

| Address | Role |
| ------- | ---- |
| `0x8B6E43CCE1961D3671a39Fe8D9E711E69ddD74ce` | USDC Prime wrapper adapter |
| `0x5b211DA4Cd92cfb9CCCFbd1De78289955EB236CD` | USDC Frontier wrapper adapter |
| `0xf691616Dd2cF85c9cA9fa32bdFf00f5cD92BAd81` | WETH Prime wrapper adapter |
| `0xa3b90423FD6f70B9f4A424dEBfB27ac502ac1464` | cbBTC Prime wrapper adapter |

**Partner depositors + Treasury (5)**

| Address | Role |
| ------- | ---- |
| `0x628037c2d25f5e5f6f90415cff6d7e8860f41c08` | Rebate allowlist |
| `0x057fd8B961Eb664baA647a5C7A6e9728fabA266A` | Treasury |
| `0xf35b121ba32cbeaa27716abeffb6b65a55f9b333` | Allowlisted depositor |
| `0x31E70f063cA802DedCd76e74C8F6D730eC43D9f0` | Rebate allowlist |
| `0x0d5a708b651fee1daa0470431c4262ab3e1d0261` | Rebate allowlist |

Partner wallets whitelisted on underlying can **deposit underlying directly** (bypass wrapper fee layer) as well as deposit wrappers freely.

### Vaults that receive `setSendAssetsGate` (4 addresses)

| Underlying vault | Address | Adapter for this vault |
| ---------------- | ------- | ---------------------- |
| Muscadine USDC Prime | `0x89712980Cb434eF5aE4AB29349419eb976B0b496` | `0x8B6E43CC…74ce` |
| Muscadine USDC Frontier | `0x314fD07319ef645bA7D548915CCd91F4788A1839` | `0x5b211DA4…36CD` |
| Muscadine WETH Prime | `0xd6dcad2f7da91fbb27bda471540d9770c97a5a43` | `0xf691616D…Ad81` |
| Muscadine cbBTC Prime | `0x99dcd0d75822ba398f13b2a8852b07c7e137ec70` | `0xa3b90423…1464` |

**Fee wrappers — no gate change:**

| Wrapper | Address |
| ------- | ------- |
| USDC Prime | `0x036A01eFdDC87F6634FFDE0533EE528b90fc7A45` |
| USDC Frontier | `0x54D8417bD21C86A7806b58f5aa2e2E0bB88B856A` |
| WETH Prime | `0x548653b09b03A69f93B3890c382fE9DcD245cbc4` |
| cbBTC Prime | `0x0e0a857d2AF1A2d43c82d1FA54766239CAb70147` |

## Rollout (no gate deploy in this repo)

1. Deploy `WhitelistSendAssetsGate(roleSetter = Curator Safe)` externally on Base.
2. muscadine-onchain `gate whitelist-config` → gate `multicall` to appoint whitelisters + allowlist adapters/depositors.
3. Curator Safe: `vault.submit(setSendAssetsGate(gate))` on **each of the four underlying vaults** (7d timelock each) via muscadine-onchain `gate submit-send-assets-gate`.
4. After timelock: accept with the same calldata (Curator Pending tab or muscadine-onchain `vault accept`).

Gate `multicall` must first call `setIsWhitelister` for **Curator Safe** and **Allocator Safe** (`0x2Ed45BB3542d06d81D117acd8A561e910A17A618`), then `setIsWhitelisted` for each depositor sender. Either whitelister can later add/remove allowlist entries; only **roleSetter** (Curator Safe) can appoint or revoke whitelisters.

Production gate deployed from Morpho [`vault-v2` `main`](https://github.com/morpho-org/vault-v2/tree/main/src/periphery/gates) **2026-09-05**: `0xb7f2598ac79a3c6406dddb81edcc60ea72a134b9` ([Basescan](https://basescan.org/address/0xb7f2598ac79a3c6406dddb81edcc60ea72a134b9)). Appoint whitelisters: `npx tsx src/cli.ts gate set-whitelister --account 0x…`.

## App UI (app.muscadine.xyz)

The **app does not call gate RPC** (`sendAssetsGate`, `canSendAssets`, or gate `isWhitelisted`). Underlying deposit visibility uses:

| Source | File |
| ------ | ---- |
| Depositor EOAs (5) | `app/src/lib/deposit-gate-config.ts` — sync from `DEPOSIT_GATE_DEPOSITOR_ALLOWLIST` here |

Gate UI is **always active** in the app (config allowlist only; no env toggle, no gate RPC).

After **any** allowlist or gate change:

1. Update `lib/config/deposit-gates.ts` (curator) and `app/src/lib/deposit-gate-config.ts` (same depositor addresses).
2. **`npx tsx src/cli.ts gate verify`** in muscadine-onchain — RPC read-only; must pass before shipping app config.
3. Redeploy app when depositor list or gate-active flag changes.

Optional backlog: revert app to live `canSendAssets` RPC — see `app/TODO.md`.

## On-chain verification (muscadine-onchain)

```bash
# After allowlist edits, timelock accepts, or before app deploy
npx tsx src/cli.ts gate verify
```

Checks:

- Each underlying vault `sendAssetsGate()` equals the configured gate (non-zero).
- Gate `isWhitelisted(address)` for all 9 config addresses.
- Sample underlying vault `canSendAssets(depositor)` for each partner/Treasury wallet.

Uses `ALCHEMY_API_KEY` when set; otherwise public Base RPC. Exit code **1** on any mismatch.

## Deallocations and force deallocate (unchanged)

We only set **`sendAssetsGate`**. Other gates stay at `0x0`.

| Operation | Blocked? |
| --------- | -------- |
| Curator **`deallocate`** | **No** |
| Wrapper **`allocate`** → adapter → underlying **`deposit`** | **No** (adapter whitelisted) |
| User **`withdraw` / `redeem` / `forceDeallocate`** on wrappers | **No** |

## Operational caveats

### Direct underlying for partners

Whitelisted partner wallets can deposit **underlying shares directly** (no wrapper fee). That is intentional for rebate / ops wallets.

### Wrapper deposits stay public on-chain

Anyone can still call `deposit` on a fee wrapper unless you add a wrapper gate later.

### Whitelist ≠ token custody

A whitelisted `msg.sender` can deposit tokens owned by another address. The gate controls **who initiates** the deposit.
