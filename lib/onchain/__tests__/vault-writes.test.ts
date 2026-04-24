/**
 * @jest-environment node
 *
 * Unit tests for `lib/onchain/vault-writes.ts`.
 *
 * Each builder is exercised in two ways:
 *   1. Shape check — the builder returns a fully-typed `wagmi`
 *      `useWriteContract` config (`{ address, abi, functionName, args }`).
 *   2. Encoding check — the args round-trip through viem's
 *      `encodeFunctionData`/`decodeFunctionData`. This proves the wrapper's
 *      arg list matches the ABI signature of the function it claims to call,
 *      catching any drift between `abis.ts` and `vault-writes.ts`.
 *
 * If a wrapper ever silently goes out of sync with the ABI (wrong arg order,
 * wrong type, renamed function), `encodeFunctionData` will throw and the
 * relevant test will fail loudly.
 */

import {
  type Address,
  type Hex,
  decodeFunctionData,
  encodeFunctionData,
  maxUint256,
  parseUnits,
  zeroAddress,
} from 'viem';
import { metaMorphoV1Abi, vaultV2Abi } from '../abis';
import {
  v1WriteConfigs,
  v2WriteConfigs,
  type MarketAllocation,
  type MarketParams,
} from '../vault-writes';

// All-lowercase so viem's checksum validation passes without us hand-rolling
// EIP-55 mixed case in test fixtures.
const VAULT_V1: Address = '0x0000000000000000000000000000000000000a11';
const VAULT_V2: Address = '0x0000000000000000000000000000000000000a22';
const ALICE: Address = '0x000000000000000000000000000000000000beef';
const BOB: Address = '0x000000000000000000000000000000000000c0de';
const ADAPTER: Address = '0x000000000000000000000000000000000000ada9';

const SAMPLE_MARKET_PARAMS: MarketParams = {
  loanToken: ALICE,
  collateralToken: BOB,
  oracle: '0x0000000000000000000000000000000000000111' as Address,
  irm: '0x0000000000000000000000000000000000000222' as Address,
  lltv: parseUnits('0.86', 18),
};

/** Re-encode + decode a write config's calldata to prove it matches the ABI. */
function roundTrip<TAbi extends readonly unknown[]>(config: {
  abi: TAbi;
  functionName: string;
  args: readonly unknown[];
}) {
  const data = encodeFunctionData({
    abi: config.abi,
    functionName: config.functionName,
    args: config.args,
  } as Parameters<typeof encodeFunctionData>[0]);
  const decoded = decodeFunctionData({ abi: config.abi, data } as Parameters<
    typeof decodeFunctionData
  >[0]);
  expect(decoded.functionName).toBe(config.functionName);
  return { data, decoded };
}

describe('v1WriteConfigs (MetaMorpho V1)', () => {
  test('reallocate — encodes ordered allocations including the maxUint256 catcher', () => {
    const allocations: MarketAllocation[] = [
      { marketParams: SAMPLE_MARKET_PARAMS, assets: 100n },
      { marketParams: { ...SAMPLE_MARKET_PARAMS, lltv: parseUnits('0.7', 18) }, assets: maxUint256 },
    ];
    const cfg = v1WriteConfigs.reallocate(VAULT_V1, allocations);
    expect(cfg.address).toBe(VAULT_V1);
    expect(cfg.functionName).toBe('reallocate');
    expect(cfg.abi).toBe(metaMorphoV1Abi);
    const { decoded } = roundTrip(cfg);
    const list = (decoded.args as readonly [readonly MarketAllocation[]])[0];
    expect(list).toHaveLength(2);
    expect(list[1].assets).toBe(maxUint256);
    expect(list[0].marketParams.lltv).toBe(parseUnits('0.86', 18));
  });

  test('reallocate — accepts an empty array (planner short-circuits before calling, but ABI allows it)', () => {
    const cfg = v1WriteConfigs.reallocate(VAULT_V1, []);
    const { decoded } = roundTrip(cfg);
    expect((decoded.args as readonly [readonly MarketAllocation[]])[0]).toHaveLength(0);
  });

  test('submitCap / acceptCap — round-trip with marketParams tuple', () => {
    const submit = v1WriteConfigs.submitCap(VAULT_V1, SAMPLE_MARKET_PARAMS, parseUnits('1000000', 6));
    const accept = v1WriteConfigs.acceptCap(VAULT_V1, SAMPLE_MARKET_PARAMS);
    expect(submit.functionName).toBe('submitCap');
    expect(accept.functionName).toBe('acceptCap');
    roundTrip(submit);
    roundTrip(accept);
  });

  test('setSupplyQueue — bytes32[]', () => {
    const ids: Hex[] = [
      ('0x' + '11'.repeat(32)) as Hex,
      ('0x' + '22'.repeat(32)) as Hex,
    ];
    const cfg = v1WriteConfigs.setSupplyQueue(VAULT_V1, ids);
    const { decoded } = roundTrip(cfg);
    expect((decoded.args as readonly [readonly Hex[]])[0]).toEqual(ids);
  });

  test('updateWithdrawQueue — uint256[]', () => {
    const cfg = v1WriteConfigs.updateWithdrawQueue(VAULT_V1, [0n, 1n, 2n]);
    const { decoded } = roundTrip(cfg);
    expect((decoded.args as readonly [readonly bigint[]])[0]).toEqual([0n, 1n, 2n]);
  });

  test('setIsAllocator — (address, bool)', () => {
    const on = v1WriteConfigs.setIsAllocator(VAULT_V1, ALICE, true);
    const off = v1WriteConfigs.setIsAllocator(VAULT_V1, ALICE, false);
    roundTrip(on);
    roundTrip(off);
    expect(on.args).toEqual([ALICE, true]);
  });

  test('setFee / setFeeRecipient', () => {
    const fee = v1WriteConfigs.setFee(VAULT_V1, parseUnits('0.1', 18));
    const recipient = v1WriteConfigs.setFeeRecipient(VAULT_V1, ALICE);
    roundTrip(fee);
    roundTrip(recipient);
  });

  test('submitTimelock / acceptTimelock', () => {
    const submit = v1WriteConfigs.submitTimelock(VAULT_V1, 86_400n);
    const accept = v1WriteConfigs.acceptTimelock(VAULT_V1);
    roundTrip(submit);
    roundTrip(accept);
    expect(accept.args).toEqual([]);
  });

  test('submitGuardian / acceptGuardian / setCurator', () => {
    roundTrip(v1WriteConfigs.submitGuardian(VAULT_V1, BOB));
    roundTrip(v1WriteConfigs.acceptGuardian(VAULT_V1));
    roundTrip(v1WriteConfigs.setCurator(VAULT_V1, ALICE));
  });

  test('transferOwnership / renounceOwnership / skim', () => {
    roundTrip(v1WriteConfigs.transferOwnership(VAULT_V1, ALICE));
    roundTrip(v1WriteConfigs.renounceOwnership(VAULT_V1));
    roundTrip(v1WriteConfigs.skim(VAULT_V1, ALICE));
  });

  test('every V1 wrapper points at a function that exists in metaMorphoV1Abi', () => {
    const wrappers = [
      v1WriteConfigs.reallocate(VAULT_V1, []),
      v1WriteConfigs.submitCap(VAULT_V1, SAMPLE_MARKET_PARAMS, 0n),
      v1WriteConfigs.acceptCap(VAULT_V1, SAMPLE_MARKET_PARAMS),
      v1WriteConfigs.setSupplyQueue(VAULT_V1, []),
      v1WriteConfigs.updateWithdrawQueue(VAULT_V1, []),
      v1WriteConfigs.setIsAllocator(VAULT_V1, ALICE, true),
      v1WriteConfigs.setFee(VAULT_V1, 0n),
      v1WriteConfigs.setFeeRecipient(VAULT_V1, ALICE),
      v1WriteConfigs.submitTimelock(VAULT_V1, 0n),
      v1WriteConfigs.acceptTimelock(VAULT_V1),
      v1WriteConfigs.submitGuardian(VAULT_V1, ALICE),
      v1WriteConfigs.acceptGuardian(VAULT_V1),
      v1WriteConfigs.setCurator(VAULT_V1, ALICE),
      v1WriteConfigs.transferOwnership(VAULT_V1, ALICE),
      v1WriteConfigs.renounceOwnership(VAULT_V1),
      v1WriteConfigs.skim(VAULT_V1, ALICE),
    ];
    const abiNames = new Set(
      metaMorphoV1Abi.filter((e) => e.type === 'function').map((e) => e.name)
    );
    for (const w of wrappers) {
      expect(abiNames.has(w.functionName)).toBe(true);
    }
  });
});

describe('v2WriteConfigs (Vault V2)', () => {
  const ID_DATA: Hex = ('0x' + 'ab'.repeat(64)) as Hex;
  const LIQUIDITY_DATA: Hex = '0xdeadbeef' as Hex;

  test('allocate / deallocate — (adapter, data, assets)', () => {
    const a = v2WriteConfigs.allocate(VAULT_V2, ADAPTER, ID_DATA, parseUnits('100', 6));
    const d = v2WriteConfigs.deallocate(VAULT_V2, ADAPTER, ID_DATA, parseUnits('50', 6));
    expect(a.functionName).toBe('allocate');
    expect(d.functionName).toBe('deallocate');
    roundTrip(a);
    roundTrip(d);
    const decodedA = decodeFunctionData({ abi: vaultV2Abi, data: encodeFunctionData(a) });
    const args = decodedA.args as readonly [Address, Hex, bigint];
    expect(args[0].toLowerCase()).toBe(ADAPTER.toLowerCase());
    expect(args[1]).toBe(ID_DATA);
    expect(args[2]).toBe(parseUnits('100', 6));
  });

  test('cap setters — (idData, newCap) for absolute and relative', () => {
    const calls = [
      v2WriteConfigs.increaseAbsoluteCap(VAULT_V2, ID_DATA, parseUnits('1000000', 6)),
      v2WriteConfigs.decreaseAbsoluteCap(VAULT_V2, ID_DATA, parseUnits('500000', 6)),
      v2WriteConfigs.increaseRelativeCap(VAULT_V2, ID_DATA, parseUnits('0.5', 18)),
      v2WriteConfigs.decreaseRelativeCap(VAULT_V2, ID_DATA, parseUnits('0.25', 18)),
    ];
    for (const c of calls) {
      expect(['increaseAbsoluteCap', 'decreaseAbsoluteCap', 'increaseRelativeCap', 'decreaseRelativeCap']).toContain(c.functionName);
      roundTrip(c);
    }
  });

  test('addAdapter / removeAdapter / setIsSentinel', () => {
    roundTrip(v2WriteConfigs.addAdapter(VAULT_V2, ADAPTER));
    roundTrip(v2WriteConfigs.removeAdapter(VAULT_V2, ADAPTER));
    roundTrip(v2WriteConfigs.setIsSentinel(VAULT_V2, ALICE, true));
  });

  test('fee/rate setters', () => {
    roundTrip(v2WriteConfigs.setPerformanceFee(VAULT_V2, parseUnits('0.1', 18)));
    roundTrip(v2WriteConfigs.setManagementFee(VAULT_V2, parseUnits('0.02', 18)));
    roundTrip(v2WriteConfigs.setMaxRate(VAULT_V2, parseUnits('1.5', 18)));
  });

  test('setLiquidityAdapterAndData — (address, bytes)', () => {
    const cfg = v2WriteConfigs.setLiquidityAdapterAndData(VAULT_V2, ADAPTER, LIQUIDITY_DATA);
    const { decoded } = roundTrip(cfg);
    const args = decoded.args as readonly [Address, Hex];
    expect(args[0].toLowerCase()).toBe(ADAPTER.toLowerCase());
    expect(args[1]).toBe(LIQUIDITY_DATA);
  });

  test('submit / revoke — opaque calldata bytes', () => {
    const payload: Hex = '0x1234' as Hex;
    roundTrip(v2WriteConfigs.submit(VAULT_V2, payload));
    roundTrip(v2WriteConfigs.revoke(VAULT_V2, payload));
  });

  test('owner / curator setters and metadata', () => {
    roundTrip(v2WriteConfigs.setOwner(VAULT_V2, ALICE));
    roundTrip(v2WriteConfigs.setCurator(VAULT_V2, BOB));
    roundTrip(v2WriteConfigs.setName(VAULT_V2, 'My Vault'));
    roundTrip(v2WriteConfigs.setSymbol(VAULT_V2, 'VLT'));
  });

  test('encodeAllocate / encodeDeallocate produce calldata that decodes back', () => {
    const allocateCall = v2WriteConfigs.encodeAllocate(ADAPTER, ID_DATA, 42n);
    const deallocateCall = v2WriteConfigs.encodeDeallocate(ADAPTER, ID_DATA, 17n);
    const decodedA = decodeFunctionData({ abi: vaultV2Abi, data: allocateCall });
    const decodedD = decodeFunctionData({ abi: vaultV2Abi, data: deallocateCall });
    expect(decodedA.functionName).toBe('allocate');
    expect(decodedD.functionName).toBe('deallocate');
    const aArgs = decodedA.args as readonly [Address, Hex, bigint];
    const dArgs = decodedD.args as readonly [Address, Hex, bigint];
    expect(aArgs[2]).toBe(42n);
    expect(dArgs[2]).toBe(17n);
  });

  test('multicall — bundles encoded allocate/deallocate calldata', () => {
    const calls: Hex[] = [
      v2WriteConfigs.encodeDeallocate(ADAPTER, ID_DATA, 25n),
      v2WriteConfigs.encodeAllocate(ADAPTER, ID_DATA, 25n),
    ];
    const cfg = v2WriteConfigs.multicall(VAULT_V2, calls);
    expect(cfg.functionName).toBe('multicall');
    const { decoded } = roundTrip(cfg);
    const inner = (decoded.args as readonly [readonly Hex[]])[0];
    expect(inner).toHaveLength(2);

    const innerDecoded = inner.map((d) => decodeFunctionData({ abi: vaultV2Abi, data: d }));
    expect(innerDecoded[0].functionName).toBe('deallocate');
    expect(innerDecoded[1].functionName).toBe('allocate');
  });

  test('every V2 wrapper points at a function that exists in vaultV2Abi', () => {
    const wrappers = [
      v2WriteConfigs.allocate(VAULT_V2, ADAPTER, '0x' as Hex, 0n),
      v2WriteConfigs.deallocate(VAULT_V2, ADAPTER, '0x' as Hex, 0n),
      v2WriteConfigs.increaseAbsoluteCap(VAULT_V2, '0x' as Hex, 0n),
      v2WriteConfigs.decreaseAbsoluteCap(VAULT_V2, '0x' as Hex, 0n),
      v2WriteConfigs.increaseRelativeCap(VAULT_V2, '0x' as Hex, 0n),
      v2WriteConfigs.decreaseRelativeCap(VAULT_V2, '0x' as Hex, 0n),
      v2WriteConfigs.addAdapter(VAULT_V2, ADAPTER),
      v2WriteConfigs.removeAdapter(VAULT_V2, ADAPTER),
      v2WriteConfigs.setPerformanceFee(VAULT_V2, 0n),
      v2WriteConfigs.setManagementFee(VAULT_V2, 0n),
      v2WriteConfigs.setMaxRate(VAULT_V2, 0n),
      v2WriteConfigs.setLiquidityAdapterAndData(VAULT_V2, ADAPTER, '0x' as Hex),
      v2WriteConfigs.submit(VAULT_V2, '0x' as Hex),
      v2WriteConfigs.revoke(VAULT_V2, '0x' as Hex),
      v2WriteConfigs.setOwner(VAULT_V2, ALICE),
      v2WriteConfigs.setCurator(VAULT_V2, ALICE),
      v2WriteConfigs.setIsSentinel(VAULT_V2, ALICE, false),
      v2WriteConfigs.setName(VAULT_V2, ''),
      v2WriteConfigs.setSymbol(VAULT_V2, ''),
      v2WriteConfigs.multicall(VAULT_V2, []),
    ];
    const abiNames = new Set(
      vaultV2Abi.filter((e) => e.type === 'function').map((e) => e.name)
    );
    for (const w of wrappers) {
      expect(abiNames.has(w.functionName)).toBe(true);
    }
  });

  test('zeroAddress is rejected by viem encoder when used as adapter? — actually accepts (sanity check)', () => {
    // viem doesn't validate address content beyond format; this is here to
    // explicitly document that we rely on on-chain checks for adapter validity.
    const cfg = v2WriteConfigs.allocate(VAULT_V2, zeroAddress, '0x' as Hex, 1n);
    expect(() => roundTrip(cfg)).not.toThrow();
  });
});
