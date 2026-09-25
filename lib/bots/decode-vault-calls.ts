import {
  decodeAbiParameters,
  decodeFunctionData,
  encodeAbiParameters,
  getAddress,
  isAddress,
  keccak256,
  parseAbiItem,
  parseAbiParameters,
  type Address,
  type Hex,
} from 'viem';
import { vaultV2Abi } from '@/lib/onchain/abis';
import { decodeMultiSend, isKnownMultiSend } from '@/lib/safe/multisend';

const MARKET_PARAMS_ABI = parseAbiParameters(
  'address, address, address, address, uint256'
);

const MARKET_CAP_ID_DATA_ABI = parseAbiParameters(
  'string, address, (address,address,address,address,uint256)'
);

const SET_IS_ALLOCATOR_ABI = parseAbiItem(
  'function setIsAllocator(address account, bool newIsAllocator)'
);

export type DecodedMarketParams = {
  /** Morpho Blue market id = keccak256(abi.encode(marketParams)). */
  marketId: Hex;
  loanAsset: Address;
  collateralAsset: Address;
  oracle: Address;
  irm: Address;
  lltv: string;
};

export type DecodedAllocationLeg = {
  kind: 'allocate' | 'deallocate';
  adapterAddress: Address;
  assets: string;
  market: DecodedMarketParams | null;
};

export type DecodedLiquiditySwitch = {
  adapterAddress: Address;
  liquidityData: Hex;
  market: DecodedMarketParams | null;
};

export type DecodedCapChange = {
  kind: 'decreaseAbsoluteCap' | 'decreaseRelativeCap';
  newCap: string;
  adapterAddress: Address | null;
  market: DecodedMarketParams | null;
  capKind: 'adapter' | 'collateral' | 'market' | 'unknown';
  collateralAddress: Address | null;
};

export type DecodedRoleChange = {
  kind: 'setIsAllocator' | 'revoke';
  account: Address | null;
  isAllocator: boolean | null;
};

export type DecodedVaultCallSummary = {
  hasAllocate: boolean;
  hasDeallocate: boolean;
  /** True for sentinel-only vault writes: cap decrease, revoke pending, remove allocator. */
  hasSentinelAction: boolean;
  liquiditySwitch: DecodedLiquiditySwitch | null;
  allocationLegs: DecodedAllocationLeg[];
  capChanges: DecodedCapChange[];
  roleChanges: DecodedRoleChange[];
};

export function decodeMarketParamsData(data: Hex): DecodedMarketParams | null {
  try {
    const [loan, col, ora, irmAddr, lltvRaw] = decodeAbiParameters(
      MARKET_PARAMS_ABI,
      data
    );
    return {
      marketId: keccak256(data),
      loanAsset: loan,
      collateralAsset: col,
      oracle: ora,
      irm: irmAddr,
      lltv: lltvRaw.toString(),
    };
  } catch {
    return null;
  }
}

function marketFromTuple(
  loan: Address,
  col: Address,
  ora: Address,
  irmAddr: Address,
  lltvRaw: bigint
): DecodedMarketParams {
  const data = encodeAbiParametersFromTuple(loan, col, ora, irmAddr, lltvRaw);
  return {
    marketId: keccak256(data),
    loanAsset: loan,
    collateralAsset: col,
    oracle: ora,
    irm: irmAddr,
    lltv: lltvRaw.toString(),
  };
}

function encodeAbiParametersFromTuple(
  loan: Address,
  col: Address,
  ora: Address,
  irmAddr: Address,
  lltvRaw: bigint
): Hex {
  return encodeAbiParameters(MARKET_PARAMS_ABI, [loan, col, ora, irmAddr, lltvRaw]);
}

/** Decode cap idData from decreaseAbsoluteCap / decreaseRelativeCap. */
export function decodeCapIdData(idData: Hex): {
  adapterAddress: Address | null;
  market: DecodedMarketParams | null;
  capKind: DecodedCapChange['capKind'];
  collateralAddress: Address | null;
} {
  try {
    const [tag, addr] = decodeAbiParameters(parseAbiParameters('string, address'), idData);
    if (tag === 'this') {
      return {
        adapterAddress: addr,
        market: null,
        capKind: 'adapter',
        collateralAddress: null,
      };
    }
    if (tag === 'collateralToken') {
      return {
        adapterAddress: null,
        market: null,
        capKind: 'collateral',
        collateralAddress: addr,
      };
    }
  } catch {
    // fall through
  }

  try {
    const [tag, adapter, params] = decodeAbiParameters(MARKET_CAP_ID_DATA_ABI, idData);
    if (tag === 'this/marketParams') {
      const [loan, col, ora, irmAddr, lltvRaw] = params as readonly [
        Address,
        Address,
        Address,
        Address,
        bigint,
      ];
      return {
        adapterAddress: adapter,
        market: marketFromTuple(loan, col, ora, irmAddr, lltvRaw),
        capKind: 'market',
        collateralAddress: null,
      };
    }
  } catch {
    // fall through
  }

  return {
    adapterAddress: null,
    market: null,
    capKind: 'unknown',
    collateralAddress: null,
  };
}

/**
 * Decode Vault V2 allocate / deallocate / setLiquidityAdapterAndData from
 * raw tx input (direct call or multicall).
 */
export function decodeVaultV2Calldata(data: Hex | undefined | null): DecodedVaultCallSummary {
  return decodeVaultV2CalldataList(data ? [data] : []);
}

/** Merge the decoded summaries of several vault calls (e.g. a Safe MultiSend). */
export function decodeVaultV2CalldataList(
  datas: ReadonlyArray<Hex | undefined | null>
): DecodedVaultCallSummary {
  const empty: DecodedVaultCallSummary = {
    hasAllocate: false,
    hasDeallocate: false,
    hasSentinelAction: false,
    liquiditySwitch: null,
    allocationLegs: [],
    capChanges: [],
    roleChanges: [],
  };
  const inspect = (calldata: Hex): void => {
    try {
      const decoded = decodeFunctionData({
        abi: vaultV2Abi,
        data: calldata,
      });
      if (decoded.functionName === 'allocate') {
        empty.hasAllocate = true;
        const [adapter, marketData, assets] = decoded.args as [Address, Hex, bigint];
        empty.allocationLegs.push({
          kind: 'allocate',
          adapterAddress: adapter,
          assets: assets.toString(),
          market: decodeMarketParamsData(marketData),
        });
      } else if (decoded.functionName === 'deallocate') {
        empty.hasDeallocate = true;
        const [adapter, marketData, assets] = decoded.args as [Address, Hex, bigint];
        empty.allocationLegs.push({
          kind: 'deallocate',
          adapterAddress: adapter,
          assets: assets.toString(),
          market: decodeMarketParamsData(marketData),
        });
      } else if (decoded.functionName === 'decreaseAbsoluteCap') {
        empty.hasSentinelAction = true;
        const [idData, newCap] = decoded.args as [Hex, bigint];
        const capMeta = decodeCapIdData(idData);
        empty.capChanges.push({
          kind: 'decreaseAbsoluteCap',
          newCap: newCap.toString(),
          adapterAddress: capMeta.adapterAddress,
          market: capMeta.market,
          capKind: capMeta.capKind,
          collateralAddress: capMeta.collateralAddress,
        });
      } else if (decoded.functionName === 'decreaseRelativeCap') {
        empty.hasSentinelAction = true;
        const [idData, newCap] = decoded.args as [Hex, bigint];
        const capMeta = decodeCapIdData(idData);
        empty.capChanges.push({
          kind: 'decreaseRelativeCap',
          newCap: newCap.toString(),
          adapterAddress: capMeta.adapterAddress,
          market: capMeta.market,
          capKind: capMeta.capKind,
          collateralAddress: capMeta.collateralAddress,
        });
      } else if (decoded.functionName === 'setLiquidityAdapterAndData') {
        const [adapter, liqData] = decoded.args as [Address, Hex];
        empty.liquiditySwitch = {
          adapterAddress: adapter,
          liquidityData: liqData,
          market: decodeMarketParamsData(liqData),
        };
      } else if (decoded.functionName === 'revoke') {
        // Sentinel can revoke pending timelocked actions.
        empty.hasSentinelAction = true;
        empty.roleChanges.push({
          kind: 'revoke',
          account: null,
          isAllocator: null,
        });
      } else if (decoded.functionName === 'submit') {
        const [inner] = decoded.args as [Hex];
        inspect(inner);
      } else if (decoded.functionName === 'multicall') {
        const [calls] = decoded.args as [readonly Hex[]];
        for (const inner of calls) {
          inspect(inner);
        }
      }
    } catch {
      // ignore undecodable vault ABI chunks
    }

    try {
      const roleDecoded = decodeFunctionData({
        abi: [SET_IS_ALLOCATOR_ABI],
        data: calldata,
      });
      if (roleDecoded.functionName === 'setIsAllocator') {
        const [account, isAllocator] = roleDecoded.args as [Address, boolean];
        // Only removing an allocator is a sentinel-style risk-off action.
        // Granting is owner/curator and must not route to the sentinel panel.
        if (!isAllocator) {
          empty.hasSentinelAction = true;
        }
        empty.roleChanges.push({
          kind: 'setIsAllocator',
          account: getAddress(account),
          isAllocator,
        });
      }
    } catch {
      // not a setIsAllocator call
    }
  };

  for (const data of datas) {
    if (data && data !== '0x') inspect(data);
  }
  return empty;
}

const EXEC_TRANSACTION_ABI = parseAbiItem(
  'function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool)'
);

/**
 * Vault calls inside a transaction's input. A role Safe acts through
 * `execTransaction`, whose outer calldata the vault ABI cannot decode; unwrap
 * it (and a MultiSend batch inside it) to reach the calls made to `vault`.
 * `viaSafe` is true when the input was a Safe execution.
 */
export function decodeTransactionVaultCalls(
  input: Hex | undefined | null,
  vault: Address
): { summary: DecodedVaultCallSummary; viaSafe: boolean } {
  if (!input || input === '0x') {
    return { summary: decodeVaultV2CalldataList([]), viaSafe: false };
  }
  let exec: readonly unknown[] | null = null;
  try {
    const decoded = decodeFunctionData({ abi: [EXEC_TRANSACTION_ABI], data: input });
    exec = decoded.args as readonly unknown[];
  } catch {
    exec = null;
  }
  if (!exec) return { summary: decodeVaultV2Calldata(input), viaSafe: false };

  const [to, , data, operation] = exec as [Address, bigint, Hex, number];
  const target = vault.toLowerCase();
  let calls: Hex[] = [];
  if (operation === 0 && to.toLowerCase() === target) {
    calls = [data];
  } else if (operation === 1 && isKnownMultiSend(to)) {
    calls = (decodeMultiSend(data) ?? [])
      .filter((inner) => inner.operation === 0 && inner.to.toLowerCase() === target)
      .map((inner) => inner.data);
  }
  return { summary: decodeVaultV2CalldataList(calls), viaSafe: true };
}

export function isHexAddress(value: string | null | undefined): value is Address {
  return Boolean(value && isAddress(value));
}

export function normalizeAddress(value: string): Address {
  return getAddress(value);
}
