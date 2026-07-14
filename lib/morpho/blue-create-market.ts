import {
  encodeAbiParameters,
  getAddress,
  isAddress,
  keccak256,
  parseAbi,
  parseAbiParameters,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem';

/**
 * Morpho Blue singleton (same address on Morpho-supported EVM chains).
 * Prefer `getCreateMarketDeployment(chainId).morpho` for create-market UI.
 */
export const MORPHO_BLUE = '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb' as Address;

/**
 * AdaptiveCurveIRM on Base. IRM addresses differ by chain — use
 * `getCreateMarketDeployment(chainId).adaptiveCurveIrm` for create-market.
 */
export const ADAPTIVE_CURVE_IRM =
  '0x46415998764C29aB2a25CbeA6254146D50D22687' as Address;

/**
 * MorphoChainlinkOracleV2Factory on Base.
 * @see https://basescan.org/address/0x2dc205f24bcb6b311e5cdf0745b0741648aebd3d
 */
export const MORPHO_CHAINLINK_ORACLE_V2_FACTORY_BASE =
  '0x2DC205F24BCb6B311E5cdf0745B0741648Aebd3d' as Address;

/** Ethereum MorphoChainlinkOracleV2Factory (different CREATE2 than Base). */
export const MORPHO_CHAINLINK_ORACLE_V2_FACTORY_ETHEREUM =
  '0x3A7bB36Ee3f3eE32A60e9f2b33c1e5f2E83ad766' as Address;

/**
 * @deprecated Prefer `getCreateMarketDeployment(chainId).chainlinkOracleFactory`
 * or the explicit `_BASE` / `_ETHEREUM` constants. Alias kept for older callers.
 */
export const MORPHO_CHAINLINK_ORACLE_V2_FACTORY =
  MORPHO_CHAINLINK_ORACLE_V2_FACTORY_BASE;

export const ZERO_ADDRESS =
  '0x0000000000000000000000000000000000000000' as Address;

/**
 * Morpho governance-enabled LLTVs (WAD).
 * @see https://docs.morpho.org/learn/concepts/market/
 */
export const LLTV_PRESETS = [
  { label: '62.5%', wad: '625000000000000000' },
  { label: '77%', wad: '770000000000000000' },
  { label: '86%', wad: '860000000000000000' },
  { label: '91.5%', wad: '915000000000000000' },
  { label: '94.5%', wad: '945000000000000000' },
  { label: '96.5%', wad: '965000000000000000' },
  { label: '98%', wad: '980000000000000000' },
] as const;

/** Default LLTV chip (highly correlated pairs). */
export const DEFAULT_LLTV_WAD = LLTV_PRESETS[2].wad;

export type MarketParamsInput = {
  loanToken: Address;
  collateralToken: Address;
  oracle: Address;
  irm: Address;
  lltv: bigint;
};

export const morphoBlueCreateMarketAbi = parseAbi([
  'function createMarket((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams)',
  'function idToMarketParams(bytes32 id) view returns (address loanToken, address collateralToken, address oracle, address irm, uint256 lltv)',
  'function isIrmEnabled(address irm) view returns (bool)',
  'function isLltvEnabled(uint256 lltv) view returns (bool)',
]);

export const morphoOracleFactoryAbi = parseAbi([
  'function createMorphoChainlinkOracleV2(address baseVault, uint256 baseVaultConversionSample, address baseFeed1, address baseFeed2, uint256 baseTokenDecimals, address quoteVault, uint256 quoteVaultConversionSample, address quoteFeed1, address quoteFeed2, uint256 quoteTokenDecimals, bytes32 salt) returns (address oracle)',
  'function isMorphoChainlinkOracleV2(address target) view returns (bool)',
  'event CreateMorphoChainlinkOracleV2(address caller, address oracle)',
]);

/** Market id = keccak256(abi.encode(MarketParams)). */
export function computeMarketId(params: MarketParamsInput): Hex {
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        'address loanToken, address collateralToken, address oracle, address irm, uint256 lltv'
      ),
      [
        params.loanToken,
        params.collateralToken,
        params.oracle,
        params.irm,
        params.lltv,
      ]
    )
  );
}

/** Format LLTV WAD as a percent string without Number() precision loss. */
export function formatLltvPercent(lltv: bigint): string {
  const hundredths = (lltv * 10000n) / 10n ** 18n;
  const whole = hundredths / 100n;
  const frac = hundredths % 100n;
  if (frac === 0n) return `${whole}%`;
  const fracStr = frac.toString().padStart(2, '0').replace(/0+$/, '');
  return `${whole}.${fracStr}%`;
}

export function isZeroAddress(address: string): boolean {
  return address.toLowerCase() === ZERO_ADDRESS.toLowerCase();
}

export type OracleLookup =
  | { status: 'idle' }
  | { status: 'loading' }
  | {
      status: 'ok';
      address: Address;
      factoryDeployed: boolean | null;
    }
  | { status: 'invalid'; address?: Address; error: string };

/**
 * Validate oracle address: contract code + factory membership.
 * `oracleFactory` is required (chain-specific — do not default to Base).
 */
export async function lookupMorphoOracle(
  client: PublicClient,
  rawAddress: string,
  oracleFactory: Address
): Promise<OracleLookup> {
  const trimmed = rawAddress.trim();
  if (!trimmed) return { status: 'idle' };

  if (!isAddress(trimmed)) {
    return { status: 'invalid', error: 'Not a valid address.' };
  }
  if (isZeroAddress(trimmed)) {
    return {
      status: 'invalid',
      error: 'Oracle cannot be the zero address.',
    };
  }

  const address = getAddress(trimmed) as Address;
  try {
    const code = await client.getBytecode({ address });
    if (!code || code === '0x') {
      return {
        status: 'invalid',
        address,
        error: 'No contract at this address.',
      };
    }

    let factoryDeployed: boolean | null = null;
    try {
      factoryDeployed = Boolean(
        await client.readContract({
          address: oracleFactory,
          abi: morphoOracleFactoryAbi,
          functionName: 'isMorphoChainlinkOracleV2',
          args: [address],
        })
      );
    } catch {
      factoryDeployed = null;
    }

    return { status: 'ok', address, factoryDeployed };
  } catch (err) {
    return {
      status: 'invalid',
      address,
      error: err instanceof Error ? err.message : 'Oracle lookup failed.',
    };
  }
}
