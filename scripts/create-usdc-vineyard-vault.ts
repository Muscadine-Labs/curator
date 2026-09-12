#!/usr/bin/env node
/**
 * Print (always) then optionally deploy Muscadine USDC Vineyard on Base.
 *
 *   npx tsx scripts/create-usdc-vineyard-vault.ts
 *   PRIVATE_KEY_8453=0x… ALCHEMY_API_KEY=… npx tsx scripts/create-usdc-vineyard-vault.ts --broadcast
 *
 * See scripts/usdc-vineyard/README.md for every vault value.
 */
import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  encodeFunctionData,
  formatUnits,
  http,
  parseAbiParameters,
  toFunctionSelector,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from '../lib/onchain/base-chain';
import {
  DEAD_SHARES_RECIPIENT,
  MORPHO_ADAPTER_REGISTRY_BASE,
  MORPHO_VAULT_V1_ADAPTER_FACTORY_BASE,
  muscadineVineyardRoles,
  UINT128_MAX,
  USDC_FRONTIER_VAULT,
  USDC_PRIME_VAULT,
  USDC_VINEYARD_ADAPTER_TARGETS,
  USDC_VINEYARD_ASSET,
  USDC_VINEYARD_ASSET_DECIMALS,
  USDC_VINEYARD_CHAIN_ID,
  USDC_VINEYARD_DEAD_DEPOSIT,
  USDC_VINEYARD_NAME,
  USDC_VINEYARD_SALT,
  USDC_VINEYARD_SYMBOL,
  VAULT_V2_FACTORY_BASE,
  WAD,
} from '../lib/config/usdc-vineyard';
import { MORPHO_GRAPHQL_ENDPOINT } from '../lib/constants';
import {
  erc20ApproveAbi,
  morphoVaultV1AdapterFactoryAbi,
  vaultV2FactoryAbi,
  vaultV2SetupAbi,
} from '../lib/onchain/vault-v2-factory';

const SET_ADAPTER_REGISTRY_SELECTOR = toFunctionSelector('setAdapterRegistry(address)');
const BROADCAST = process.argv.includes('--broadcast');

type PrimeSnapshot = {
  owner: Address | null;
  curator: Address | null;
  allocators: Address[];
  sentinels: Address[];
  maxRate: bigint;
  performanceFee: bigint;
  managementFee: bigint;
  performanceFeeRecipient: Address | null;
  managementFeeRecipient: Address | null;
  adapterRegistry: Address | null;
  timelocks: Array<{
    selector: Hex;
    functionName: string;
    durationSeconds: number;
    abdicatedAt: number | null;
  }>;
};

function rpcUrl(): string {
  const key = process.env.ALCHEMY_API_KEY?.trim() || process.env.NEXT_PUBLIC_ALCHEMY_API_KEY?.trim();
  if (key) return `https://base-mainnet.g.alchemy.com/v2/${key}`;
  return 'https://mainnet.base.org';
}

function publicClient() {
  return createPublicClient({ chain: base, transport: http(rpcUrl()) });
}

function adapterIdData(adapter: Address): Hex {
  return encodeAbiParameters(parseAbiParameters('string, address'), ['this', adapter]);
}

function formatDuration(seconds: number): string {
  if (seconds === 0) return 'instant';
  const days = Math.floor(seconds / 86400);
  if (days >= 1 && seconds % 86400 === 0) return `${days}d`;
  return `${seconds}s`;
}

async function fetchPrimeSnapshot(): Promise<PrimeSnapshot> {
  const client = publicClient();
  const [
    owner,
    curator,
    maxRate,
    performanceFee,
    managementFee,
    performanceFeeRecipient,
    managementFeeRecipient,
    adapterRegistry,
  ] = await client.multicall({
    allowFailure: false,
    contracts: [
      { address: USDC_PRIME_VAULT, abi: vaultV2SetupAbi, functionName: 'owner' },
      { address: USDC_PRIME_VAULT, abi: vaultV2SetupAbi, functionName: 'curator' },
      { address: USDC_PRIME_VAULT, abi: vaultV2SetupAbi, functionName: 'maxRate' },
      { address: USDC_PRIME_VAULT, abi: vaultV2SetupAbi, functionName: 'performanceFee' },
      { address: USDC_PRIME_VAULT, abi: vaultV2SetupAbi, functionName: 'managementFee' },
      { address: USDC_PRIME_VAULT, abi: vaultV2SetupAbi, functionName: 'performanceFeeRecipient' },
      { address: USDC_PRIME_VAULT, abi: vaultV2SetupAbi, functionName: 'managementFeeRecipient' },
      { address: USDC_PRIME_VAULT, abi: vaultV2SetupAbi, functionName: 'adapterRegistry' },
    ],
  });

  const gqlRes = await fetch(MORPHO_GRAPHQL_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `query ($address: String!, $chainId: Int!) {
        vault: vaultV2ByAddress(address: $address, chainId: $chainId) {
          allocators { allocator { address } }
          sentinels { sentinel { address } }
          timelocks { selector functionName duration abdicatedAt }
        }
      }`,
      variables: { address: USDC_PRIME_VAULT, chainId: USDC_VINEYARD_CHAIN_ID },
    }),
  });
  const gqlJson = (await gqlRes.json()) as {
    data?: {
      vault?: {
        allocators?: Array<{ allocator?: { address?: string } | null } | null> | null;
        sentinels?: Array<{ sentinel?: { address?: string } | null } | null> | null;
        timelocks?: Array<{
          selector?: string | null;
          functionName?: string | null;
          duration?: number | string | null;
          abdicatedAt?: number | string | null;
        } | null> | null;
      } | null;
    };
    errors?: Array<{ message?: string }>;
  };
  if (gqlJson.errors?.length) {
    throw new Error(`Morpho GraphQL: ${gqlJson.errors.map((e) => e.message).join('; ')}`);
  }

  const vault = gqlJson.data?.vault;
  const allocators = (vault?.allocators ?? [])
    .map((row) => row?.allocator?.address)
    .filter((a): a is string => Boolean(a))
    .map((a) => a as Address);
  const sentinels = (vault?.sentinels ?? [])
    .map((row) => row?.sentinel?.address)
    .filter((a): a is string => Boolean(a))
    .map((a) => a as Address);
  const timelocks = (vault?.timelocks ?? [])
    .filter((t): t is NonNullable<typeof t> => Boolean(t?.selector && t.functionName))
    .map((t) => ({
      selector: t.selector as Hex,
      functionName: String(t.functionName),
      durationSeconds: Number(t.duration ?? 0),
      abdicatedAt:
        t.abdicatedAt != null && Number(t.abdicatedAt) > 0 ? Number(t.abdicatedAt) : null,
    }));

  return {
    owner,
    curator,
    allocators,
    sentinels,
    maxRate,
    performanceFee,
    managementFee,
    performanceFeeRecipient,
    managementFeeRecipient,
    adapterRegistry,
    timelocks,
  };
}

function printPlan(options: {
  deployer: Address | null;
  predictedVault: Address | null;
  prime: PrimeSnapshot;
}): void {
  const roles = muscadineVineyardRoles();
  console.log('\n# Muscadine USDC Vineyard — pre-deploy plan\n');
  console.log('See scripts/usdc-vineyard/README.md for the full write-up.\n');
  console.log('## Identity');
  console.log(`  name:     ${USDC_VINEYARD_NAME}`);
  console.log(`  symbol:   ${USDC_VINEYARD_SYMBOL}`);
  console.log(`  chain:    Base ${USDC_VINEYARD_CHAIN_ID}`);
  console.log(`  asset:    ${USDC_VINEYARD_ASSET} (USDC, ${USDC_VINEYARD_ASSET_DECIMALS} dp)`);
  console.log(`  salt:     ${USDC_VINEYARD_SALT}`);
  console.log(`  factory:  ${VAULT_V2_FACTORY_BASE}`);
  console.log(`  adapters: MorphoVaultV1AdapterFactory ${MORPHO_VAULT_V1_ADAPTER_FACTORY_BASE}`);
  console.log(`  deployer: ${options.deployer ?? '(set PRIVATE_KEY_8453 to predict address)'}`);
  console.log(`  predicted vault: ${options.predictedVault ?? '(needs deployer)'}`);
  console.log('\n## Roles (Muscadine Safes — same as Prime)');
  console.log(`  owner:     ${roles.owner}`);
  console.log(`  curator:   ${roles.curator}`);
  console.log(`  allocator: ${roles.allocator}`);
  console.log(`  sentinel:  ${roles.sentinel}`);
  console.log('\n## Live USDC Prime snapshot (copied)');
  console.log(`  owner:     ${options.prime.owner}`);
  console.log(`  curator:   ${options.prime.curator}`);
  console.log(`  allocators:${options.prime.allocators.join(', ') || ' none'}`);
  console.log(`  sentinels: ${options.prime.sentinels.join(', ') || ' none'}`);
  console.log(`  maxRate:   ${options.prime.maxRate.toString()}`);
  console.log(`  perfFee:   ${options.prime.performanceFee.toString()}`);
  console.log(`  mgmtFee:   ${options.prime.managementFee.toString()}`);
  console.log(`  perf recip:${options.prime.performanceFeeRecipient}`);
  console.log(`  mgmt recip:${options.prime.managementFeeRecipient}`);
  console.log(
    `  registry:  ${options.prime.adapterRegistry}  ← Vineyard will NOT copy this`
  );
  console.log('\n## Timelocks (copied except setAdapterRegistry abdication)');
  const sorted = [...options.prime.timelocks].sort((a, b) =>
    a.functionName.localeCompare(b.functionName)
  );
  for (const t of sorted) {
    const abd = t.abdicatedAt
      ? ` abdicated@${t.abdicatedAt}`
      : ` ${formatDuration(t.durationSeconds)}`;
    const skip =
      t.selector.toLowerCase() === SET_ADAPTER_REGISTRY_SELECTOR.toLowerCase()
        ? '  [SKIP registry]'
        : '';
    console.log(`  ${t.functionName.padEnd(28)} ${t.selector} ${abd}${skip}`);
  }
  console.log('\n## Adapters');
  for (const target of USDC_VINEYARD_ADAPTER_TARGETS) {
    console.log(
      `  ${target.label}  ${target.childVault}  liquidity=${target.liquidity}  data=0x  absCap=uint128.max  relCap=1e18`
    );
  }
  console.log('\n## Other');
  console.log(`  Morpho registry ${MORPHO_ADAPTER_REGISTRY_BASE}: NOT set, NOT abdicated`);
  console.log(`  sendAssetsGate: unset (public deposits)`);
  console.log(
    `  dead deposit: ${formatUnits(USDC_VINEYARD_DEAD_DEPOSIT, USDC_VINEYARD_ASSET_DECIMALS)} USDC → ${DEAD_SHARES_RECIPIENT}`
  );
  console.log(`  Prime child:    ${USDC_PRIME_VAULT}`);
  console.log(`  Frontier child: ${USDC_FRONTIER_VAULT}`);
  console.log('');
}

async function curatorCall(
  wallet: ReturnType<typeof createWalletClient>,
  account: Address,
  vault: Address,
  data: Hex
): Promise<void> {
  // Timelock is 0 at creation: submit then execute the inner call.
  const hash1 = await wallet.writeContract({
    account,
    address: vault,
    abi: vaultV2SetupAbi,
    functionName: 'submit',
    args: [data],
    chain: base,
  });
  await publicClient().waitForTransactionReceipt({ hash: hash1 });
  const hash2 = await wallet.sendTransaction({
    account,
    to: vault,
    data,
    chain: base,
  });
  await publicClient().waitForTransactionReceipt({ hash: hash2 });
}

async function deploy(prime: PrimeSnapshot): Promise<void> {
  const pk = process.env.PRIVATE_KEY_8453?.trim();
  if (!pk) {
    throw new Error('PRIVATE_KEY_8453 is required for --broadcast');
  }
  const account = privateKeyToAccount(pk as Hex);
  const wallet = createWalletClient({
    account,
    chain: base,
    transport: http(rpcUrl()),
  });
  const client = publicClient();
  const roles = muscadineVineyardRoles();
  const deployer = account.address;

  const predicted = await client.readContract({
    address: VAULT_V2_FACTORY_BASE,
    abi: vaultV2FactoryAbi,
    functionName: 'vaultV2',
    args: [deployer, USDC_VINEYARD_ASSET, USDC_VINEYARD_SALT],
  });
  console.log(`Deploying vault to ${predicted} from ${deployer}…`);

  const createHash = await wallet.writeContract({
    address: VAULT_V2_FACTORY_BASE,
    abi: vaultV2FactoryAbi,
    functionName: 'createVaultV2',
    args: [deployer, USDC_VINEYARD_ASSET, USDC_VINEYARD_SALT],
    chain: base,
    account,
  });
  await client.waitForTransactionReceipt({ hash: createHash });
  const vault = predicted;
  console.log(`Vault deployed: ${vault}`);

  for (const [fn, arg] of [
    ['setName', USDC_VINEYARD_NAME],
    ['setSymbol', USDC_VINEYARD_SYMBOL],
  ] as const) {
    const hash = await wallet.writeContract({
      address: vault,
      abi: vaultV2SetupAbi,
      functionName: fn,
      args: [arg],
      chain: base,
      account,
    });
    await client.waitForTransactionReceipt({ hash });
  }

  const setCuratorHash = await wallet.writeContract({
    address: vault,
    abi: vaultV2SetupAbi,
    functionName: 'setCurator',
    args: [deployer],
    chain: base,
    account,
  });
  await client.waitForTransactionReceipt({ hash: setCuratorHash });

  await curatorCall(
    wallet,
    deployer,
    vault,
    encodeFunctionData({
      abi: vaultV2SetupAbi,
      functionName: 'setIsAllocator',
      args: [deployer, true],
    })
  );

  const adapters: { label: string; address: Address; liquidity: boolean }[] = [];
  for (const target of USDC_VINEYARD_ADAPTER_TARGETS) {
    const hash = await wallet.writeContract({
      address: MORPHO_VAULT_V1_ADAPTER_FACTORY_BASE,
      abi: morphoVaultV1AdapterFactoryAbi,
      functionName: 'createMorphoVaultV1Adapter',
      args: [vault, target.childVault],
      chain: base,
      account,
    });
    const receipt = await client.waitForTransactionReceipt({ hash });
    const created = await client.readContract({
      address: MORPHO_VAULT_V1_ADAPTER_FACTORY_BASE,
      abi: morphoVaultV1AdapterFactoryAbi,
      functionName: 'morphoVaultV1Adapter',
      args: [vault, target.childVault],
    });
    adapters.push({ label: target.label, address: created, liquidity: target.liquidity });
    console.log(`Adapter ${target.label}: ${created}  (tx ${receipt.transactionHash})`);
  }

  for (const adapter of adapters) {
    await curatorCall(
      wallet,
      deployer,
      vault,
      encodeFunctionData({
        abi: vaultV2SetupAbi,
        functionName: 'addAdapter',
        args: [adapter.address],
      })
    );
    const idData = adapterIdData(adapter.address);
    await curatorCall(
      wallet,
      deployer,
      vault,
      encodeFunctionData({
        abi: vaultV2SetupAbi,
        functionName: 'increaseAbsoluteCap',
        args: [idData, UINT128_MAX],
      })
    );
    await curatorCall(
      wallet,
      deployer,
      vault,
      encodeFunctionData({
        abi: vaultV2SetupAbi,
        functionName: 'increaseRelativeCap',
        args: [idData, WAD],
      })
    );
  }

  const liquidity = adapters.find((a) => a.liquidity);
  if (!liquidity) throw new Error('No liquidity adapter configured');
  const liqHash = await wallet.writeContract({
    address: vault,
    abi: vaultV2SetupAbi,
    functionName: 'setLiquidityAdapterAndData',
    args: [liquidity.address, '0x'],
    chain: base,
    account,
  });
  await client.waitForTransactionReceipt({ hash: liqHash });

  if (prime.performanceFeeRecipient) {
    await curatorCall(
      wallet,
      deployer,
      vault,
      encodeFunctionData({
        abi: vaultV2SetupAbi,
        functionName: 'setPerformanceFeeRecipient',
        args: [prime.performanceFeeRecipient],
      })
    );
  }
  if (prime.managementFeeRecipient) {
    await curatorCall(
      wallet,
      deployer,
      vault,
      encodeFunctionData({
        abi: vaultV2SetupAbi,
        functionName: 'setManagementFeeRecipient',
        args: [prime.managementFeeRecipient],
      })
    );
  }
  if (prime.performanceFee > 0n) {
    await curatorCall(
      wallet,
      deployer,
      vault,
      encodeFunctionData({
        abi: vaultV2SetupAbi,
        functionName: 'setPerformanceFee',
        args: [prime.performanceFee],
      })
    );
  }
  if (prime.managementFee > 0n) {
    await curatorCall(
      wallet,
      deployer,
      vault,
      encodeFunctionData({
        abi: vaultV2SetupAbi,
        functionName: 'setManagementFee',
        args: [prime.managementFee],
      })
    );
  }
  if (prime.maxRate > 0n) {
    const maxHash = await wallet.writeContract({
      address: vault,
      abi: vaultV2SetupAbi,
      functionName: 'setMaxRate',
      args: [prime.maxRate],
      chain: base,
      account,
    });
    await client.waitForTransactionReceipt({ hash: maxHash });
  }

  const timelocks = [...prime.timelocks].sort((a, b) => {
    if (a.functionName === 'increaseTimelock') return 1;
    if (b.functionName === 'increaseTimelock') return -1;
    return 0;
  });
  for (const t of timelocks) {
    const isRegistry =
      t.selector.toLowerCase() === SET_ADAPTER_REGISTRY_SELECTOR.toLowerCase();
    if (isRegistry) continue;
    if (t.abdicatedAt) {
      await curatorCall(
        wallet,
        deployer,
        vault,
        encodeFunctionData({
          abi: vaultV2SetupAbi,
          functionName: 'abdicate',
          args: [t.selector],
        })
      );
      continue;
    }
    if (t.durationSeconds > 0) {
      await curatorCall(
        wallet,
        deployer,
        vault,
        encodeFunctionData({
          abi: vaultV2SetupAbi,
          functionName: 'increaseTimelock',
          args: [t.selector, BigInt(t.durationSeconds)],
        })
      );
    }
  }

  await curatorCall(
    wallet,
    deployer,
    vault,
    encodeFunctionData({
      abi: vaultV2SetupAbi,
      functionName: 'setIsAllocator',
      args: [roles.allocator, true],
    })
  );
  await curatorCall(
    wallet,
    deployer,
    vault,
    encodeFunctionData({
      abi: vaultV2SetupAbi,
      functionName: 'setIsAllocator',
      args: [deployer, false],
    })
  );

  const sentinelHash = await wallet.writeContract({
    address: vault,
    abi: vaultV2SetupAbi,
    functionName: 'setIsSentinel',
    args: [roles.sentinel, true],
    chain: base,
    account,
  });
  await client.waitForTransactionReceipt({ hash: sentinelHash });

  const curatorHash = await wallet.writeContract({
    address: vault,
    abi: vaultV2SetupAbi,
    functionName: 'setCurator',
    args: [roles.curator],
    chain: base,
    account,
  });
  await client.waitForTransactionReceipt({ hash: curatorHash });

  const usdcBal = await client.readContract({
    address: USDC_VINEYARD_ASSET,
    abi: erc20ApproveAbi,
    functionName: 'balanceOf',
    args: [deployer],
  });
  if (usdcBal < USDC_VINEYARD_DEAD_DEPOSIT) {
    throw new Error(
      `Deployer USDC ${formatUnits(usdcBal, USDC_VINEYARD_ASSET_DECIMALS)} < dead deposit ${formatUnits(USDC_VINEYARD_DEAD_DEPOSIT, USDC_VINEYARD_ASSET_DECIMALS)}`
    );
  }
  const approveHash = await wallet.writeContract({
    address: USDC_VINEYARD_ASSET,
    abi: erc20ApproveAbi,
    functionName: 'approve',
    args: [vault, USDC_VINEYARD_DEAD_DEPOSIT],
    chain: base,
    account,
  });
  await client.waitForTransactionReceipt({ hash: approveHash });
  const depositHash = await wallet.writeContract({
    address: vault,
    abi: vaultV2SetupAbi,
    functionName: 'deposit',
    args: [USDC_VINEYARD_DEAD_DEPOSIT, DEAD_SHARES_RECIPIENT],
    chain: base,
    account,
  });
  await client.waitForTransactionReceipt({ hash: depositHash });

  const ownerHash = await wallet.writeContract({
    address: vault,
    abi: vaultV2SetupAbi,
    functionName: 'setOwner',
    args: [roles.owner],
    chain: base,
    account,
  });
  await client.waitForTransactionReceipt({ hash: ownerHash });

  console.log('\nDeploy complete.');
  console.log(`  vault: ${vault}`);
  for (const adapter of adapters) {
    console.log(`  ${adapter.label} adapter: ${adapter.address}${adapter.liquidity ? ' (liquidity)' : ''}`);
  }
  console.log('\nNext:');
  console.log('  1. Add the vault (and adapters) to lib/config/vaults.ts');
  console.log('  2. Whitelist both adapters on the send-assets gate (/curator/gates)');
  console.log('  3. Do NOT register with Morpho adapter registry');
}

async function main(): Promise<void> {
  const prime = await fetchPrimeSnapshot();
  const pk = process.env.PRIVATE_KEY_8453?.trim();
  let deployer: Address | null = null;
  let predicted: Address | null = null;
  if (pk) {
    const account = privateKeyToAccount(pk as Hex);
    deployer = account.address;
    predicted = await publicClient().readContract({
      address: VAULT_V2_FACTORY_BASE,
      abi: vaultV2FactoryAbi,
      functionName: 'vaultV2',
      args: [deployer, USDC_VINEYARD_ASSET, USDC_VINEYARD_SALT],
    });
  }
  printPlan({ deployer, predictedVault: predicted, prime });

  if (!BROADCAST) {
    console.log('Dry run only. Pass --broadcast (and PRIVATE_KEY_8453) to deploy.\n');
    return;
  }
  await deploy(prime);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
