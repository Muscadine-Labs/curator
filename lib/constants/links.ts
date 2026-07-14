import type { ExternalLinkItem, MorphoAutomationBot } from '@/lib/constants/types';

/** Safe Developer Dashboard — API keys, Transaction Service, app registration. */
export const SAFE_DEVELOPER_DASHBOARD_URL = 'https://developer.safe.global/login';

/** Muscadine Labs Safe{Wallet} space on app.safe.global. */
export const MUSCADINE_SAFE_SPACE_URL =
  'https://app.safe.global/spaces?spaceId=2510f9d4-505e-4da8-8e40-2d55d721ae0a';

export const MUSCADINE_DOMAINS: readonly ExternalLinkItem[] = [
  { name: 'Muscadine', url: 'https://muscadine.xyz', description: 'Website' },
  { name: 'Analytics', url: 'https://analytics.muscadine.xyz', description: 'Analytics' },
  { name: 'App', url: 'https://app.muscadine.xyz', description: 'App' },
  { name: 'Curator', url: 'https://curator.muscadine.xyz', description: 'Curator' },
  { name: 'Portfolio', url: 'https://portfolio.muscadine.xyz', description: 'Portfolio' },
  { name: 'Portfolio API', url: 'https://api-portfolio.muscadine.io', description: 'Portfolio API' },
  { name: 'Docs', url: 'https://docs.muscadine.xyz', description: 'Documentation' },
];

export const MUSCADINE_DEVELOPMENT_LINKS: readonly ExternalLinkItem[] = [
  { name: 'GitHub', url: 'https://github.com/Muscadine-Labs', description: 'Muscadine-Labs' },
  { name: 'Vercel', url: 'https://vercel.com/muscadine-labs', description: 'muscadine-labs' },
  {
    name: 'Google Drive',
    url: 'https://drive.google.com/drive/u/1/folders/15YowG9xg376DzOftvXj2vQvTeXX9cZJc',
    description: 'Drive folder',
    displayText: 'drive.google.com',
  },
];

export const MUSCADINE_BUSINESS_SERVICES: readonly ExternalLinkItem[] = [
  { name: 'Georgia Secretary of State', url: 'https://ecorp.sos.ga.gov/', description: 'ecorp.sos.ga.gov' },
  { name: 'NameSilo', url: 'https://www.namesilo.com/', description: 'Domain registrar' },
];

export const MUSCADINE_SAFE_LINKS: readonly ExternalLinkItem[] = [
  {
    name: 'Safe Developer',
    url: SAFE_DEVELOPER_DASHBOARD_URL,
    description: 'API keys, Transaction Service, Safe App registration',
    displayText: 'developer.safe.global',
  },
  {
    name: 'Muscadine Safe Workspace',
    url: MUSCADINE_SAFE_SPACE_URL,
    description: 'Multisig workspace on Safe{Wallet}',
    displayText: 'app.safe.global',
  },
];

export const COINBASE_DEV_LINKS: readonly ExternalLinkItem[] = [
  { name: 'Base Build', url: 'https://www.base.dev/', description: 'base.dev' },
  { name: 'CDP Portal', url: 'https://portal.cdp.coinbase.com/', description: 'portal.cdp.coinbase.com' },
];

export const INFRASTRUCTURE_DEV_LINKS: readonly ExternalLinkItem[] = [
  { name: 'Alchemy', url: 'https://dashboard.alchemy.com/', description: 'RPC dashboard' },
  { name: 'WalletConnect Cloud', url: 'https://cloud.walletconnect.com/', description: 'WalletConnect' },
];

export const MORPHO_CURATOR_V1_URL = 'https://curator-v1.morpho.org/';
export const MORPHO_CURATOR_V2_VAULTS_URL = 'https://curator.morpho.org/vaults';

/** Morpho Oracle Portal — Decoder + Tester for oracle / feed validation. */
export const MORPHO_ORACLE_PORTAL_URL = 'https://oracles.morpho.dev/';

export const MORPHO_AUTOMATION_BOTS: readonly MorphoAutomationBot[] = [
  {
    title: 'Morpho Liquidation Bot',
    description: 'Easily configurable liquidation bot for Morpho Blue.',
    body: 'Monitors and executes liquidations on Morpho Blue markets, helping maintain protocol health and providing liquidation opportunities.',
    href: 'https://github.com/morpho-org/morpho-blue-liquidation-bot',
  },
  {
    title: 'Morpho Blue Reallocation Bot (V1)',
    description: 'A simple, fast, and easily deployable reallocation bot for the Morpho Blue protocol.',
    body: 'Automatically rebalances assets within MetaMorpho vaults to maintain capital efficiency by equalizing utilization rates across markets.',
    href: 'https://github.com/morpho-org/morpho-blue-reallocation-bot',
  },
  {
    title: 'Morpho Vault V2 Reallocation Bot',
    description: 'Reallocation bot for Morpho Vault V2 protocol.',
    body: 'Handles reallocation for Morpho Vault V2, managing asset distribution across markets to optimize capital efficiency and maintain target allocations.',
    href: 'https://github.com/morpho-org/vault-v2-reallocation-bot',
  },
];
