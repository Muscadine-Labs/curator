# Muscadine USDC Vineyard (mvUSDC)

Pre-deploy values for the Base Vault V2 that allocates into **Muscadine USDC Prime** and **Muscadine USDC Frontier**. The create script always prints this plan (and live Prime roles / timelocks) before sending any transaction.

```bash
# Print plan + live Prime snapshot (no transactions)
npx tsx scripts/create-usdc-vineyard-vault.ts

# Broadcast (deployer EOA is temporary owner, then transfers to Owner Safe)
PRIVATE_KEY_8453=0x… ALCHEMY_API_KEY=… npx tsx scripts/create-usdc-vineyard-vault.ts --broadcast
```

## Identity

| Field | Value |
| --- | --- |
| Name | Muscadine USDC Vineyard |
| Symbol | mvUSDC |
| Chain | Base (`8453`) |
| Asset | USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (6 decimals) |
| CREATE2 salt | `keccak256("muscadine-usdc-vineyard-mvUSDC-v1")` |
| Factory | VaultV2Factory `0x4501125508079A99ebBebCE205DeC9593C2b5857` |
| Adapter factory | MorphoVaultV1AdapterFactory `0xF42D9c36b34c9c2CF3Bc30eD2a52a90eEB604642` |

The predicted vault address depends on **temporary owner** (the deployer EOA) + asset + salt. The script prints it before broadcast.

## Roles (copied from Muscadine USDC Prime)

Same Muscadine Safes as Prime:

| Role | Address |
| --- | --- |
| Owner | `0x4E5D3ef790C75682ac4f6d4C1dDCc08b36fC100A` |
| Curator | `0xb6d1d784e9Bc3570546e231caCB52B4E0f1ED8b1` |
| Allocator | `0x2Ed45BB3542d06d81D117acd8A561e910A17A618` |
| Sentinel | `0x64e804eEF4F5a53272A8623b563ad2724E98A0a9` |

The script also **reads Prime on-chain** (`owner`, `curator`, `isAllocator`, `isSentinel`, fees, max rate, every timelock) and copies those values. If Prime has extra allocators/sentinels, they are printed so you can confirm.

## Adapters (two)

| Adapter | Child vault | Liquidity adapter? | Allocate `data` | Adapter cap idData |
| --- | --- | --- | --- | --- |
| MorphoVaultV1Adapter → USDC Prime | `0x89712980Cb434eF5aE4AB29349419eb976B0b496` | Yes | `0x` | `abi.encode("this", adapter)` |
| MorphoVaultV1Adapter → USDC Frontier | `0x314fD07319ef645bA7D548915CCd91F4788A1839` | No | `0x` | `abi.encode("this", adapter)` |

Initial caps (tighten later via Curator Safe):

| Cap | Value |
| --- | --- |
| Absolute (each adapter) | `type(uint128).max` |
| Relative (each adapter) | `1e18` (100%) |

## Morpho registry — **not** used

Prime (and Morpho Curator production vaults) set Morpho's adapter registry `0x5C2531Cbd2cf112Cf687da3Cd536708aDd7DB10a` and **abdicate** `setAdapterRegistry`.

Vineyard does **not**:

- `adapterRegistry` stays `0x0000…0000`
- `setAdapterRegistry` is **not** called
- `setAdapterRegistry` is **not** abdicated

That is the only intentional governance difference vs Prime.

## Fees, max rate, timelocks

Copied live from USDC Prime at deploy time (script prints the snapshot). Typical Prime pattern:

- Performance / management fee + recipients = Prime's on-chain values
- Timelock durations = Prime's on-chain `timelock(selector)` for each curator function
- Abdications = Prime's `abdicated(selector)`, **except** `setAdapterRegistry`

Vineyard **does not** set `sendAssetsGate`. It is a public deposit product. Prime's gate stays on Prime (underlying-only). After adapters exist, whitelist them on the shared send-assets gate so Vineyard can `deposit` into Prime/Frontier:

```
Gate 0xb7f2598ac79a3c6406dddb81edcc60ea72a134b9
Allocator or Curator Safe → gate.setIsWhitelisted(primeAdapter, true)
Allocator or Curator Safe → gate.setIsWhitelisted(frontierAdapter, true)
```

Use `/curator/gates` after deploy.

## Dead deposit

`1e12` USDC (Morpho rule for ≤ 9 decimal assets) to `0x0000…dead`. The deployer EOA needs this USDC balance plus gas.

## Deploy order

1. Print this plan + live Prime snapshot (always).
2. `factory.createVaultV2(temporaryOwner=deployer, USDC, salt)`.
3. `setName` / `setSymbol`.
4. `setCurator(deployer)` temporarily.
5. Create two adapters via MorphoVaultV1AdapterFactory.
6. `submit` + execute: allocators, adapters, caps (timelock is 0 at creation).
7. Copy Prime fees, recipients, max rate.
8. Set Prime adapter as liquidity adapter (`data = 0x`).
9. Copy Prime timelocks / abdications except registry.
10. `setIsSentinel(Sentinel Safe)`, `setIsAllocator(Allocator Safe)`, `setCurator(Curator Safe)`, `setOwner(Owner Safe)`.
11. Approve + dead deposit.
12. Print adapter addresses — add them to `lib/config/vaults.ts` and the send-assets gate allowlist after you accept the vault.

Do not register the vault on Morpho's curator registry / Morpho app listing as part of this script.
