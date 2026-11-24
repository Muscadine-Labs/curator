import { parseAbi } from 'viem';

export const vaultV2FactoryAbi = parseAbi([
  'function createVaultV2(address owner, address asset, bytes32 salt) returns (address newVaultV2)',
  'function vaultV2(address owner, address asset, bytes32 salt) view returns (address)',
  'function isVaultV2(address account) view returns (bool)',
  'event CreateVaultV2(address indexed owner, address indexed asset, bytes32 salt, address indexed newVaultV2)',
]);

export const morphoVaultV1AdapterFactoryAbi = parseAbi([
  'function createMorphoVaultV1Adapter(address parentVault, address morphoVaultV1) returns (address)',
  'function morphoVaultV1Adapter(address parentVault, address morphoVaultV1) view returns (address)',
  'function isMorphoVaultV1Adapter(address account) view returns (bool)',
]);

/** Extra Vault V2 writes used at deploy time (not all are in vaultV2Abi). */
export const vaultV2SetupAbi = parseAbi([
  'function owner() view returns (address)',
  'function curator() view returns (address)',
  'function asset() view returns (address)',
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function maxRate() view returns (uint256)',
  'function performanceFee() view returns (uint256)',
  'function managementFee() view returns (uint256)',
  'function performanceFeeRecipient() view returns (address)',
  'function managementFeeRecipient() view returns (address)',
  'function adapterRegistry() view returns (address)',
  'function isAllocator(address account) view returns (bool)',
  'function isSentinel(address account) view returns (bool)',
  'function timelock(bytes4 selector) view returns (uint256)',
  'function abdicated(bytes4 selector) view returns (bool)',
  'function setName(string newName)',
  'function setSymbol(string newSymbol)',
  'function setCurator(address newCurator)',
  'function setOwner(address newOwner)',
  'function setIsAllocator(address account, bool newIsAllocator)',
  'function setIsSentinel(address account, bool newIsSentinel)',
  'function submit(bytes data)',
  'function addAdapter(address account)',
  'function increaseAbsoluteCap(bytes idData, uint256 newAbsoluteCap) returns (bytes32)',
  'function increaseRelativeCap(bytes idData, uint256 newRelativeCap) returns (bytes32)',
  'function setLiquidityAdapterAndData(address newLiquidityAdapter, bytes newLiquidityData)',
  'function setMaxRate(uint256 newMaxRate)',
  'function setPerformanceFee(uint256 newFee)',
  'function setManagementFee(uint256 newFee)',
  'function setPerformanceFeeRecipient(address newFeeRecipient)',
  'function setManagementFeeRecipient(address newFeeRecipient)',
  'function increaseTimelock(bytes4 selector, uint256 newDuration)',
  'function abdicate(bytes4 selector)',
  'function deposit(uint256 assets, address onBehalf) returns (uint256)',
  'function multicall(bytes[] data)',
]);

export const erc20ApproveAbi = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
]);
