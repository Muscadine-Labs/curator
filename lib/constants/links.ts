import type { ExternalLinkItem, MorphoAutomationBot } from '@/lib/constants/types';

/** Safe Developer Dashboard — API keys, Transaction Service, app registration. */
export const SAFE_DEVELOPER_DASHBOARD_URL = 'https://developer.safe.global';

/** Safe{Wallet}. */
export const MUSCADINE_SAFE_SPACE_URL = 'https://app.safe.global';

export const MUSCADINE_DOMAINS: readonly ExternalLinkItem[] = [
  { name: 'Muscadine', url: 'https://muscadine.xyz', description: 'Website' },
  { name: 'App', url: 'https://app.muscadine.xyz', description: 'App' },
  { name: 'Curator', url: 'https://curator.muscadine.xyz', description: 'Curator' },
];

export const MUSCADINE_DEVELOPMENT_LINKS: readonly ExternalLinkItem[] = [
  { name: 'GitHub', url: 'https://github.com', description: 'github.com' },
  { name: 'Vercel', url: 'https://vercel.com', description: 'vercel.com' },
  { name: 'Cloudflare', url: 'https://www.cloudflare.com/', description: 'DNS and CDN' },
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
  { name: 'Reown', url: 'https://reown.com/', description: 'Wallet infra (AppKit)' },
  { name: 'WalletConnect Cloud', url: 'https://cloud.walletconnect.com/', description: 'WalletConnect' },
];

export const MORPHO_CURATOR_V2_VAULTS_URL = 'https://curator.morpho.org/vaults';
export const MORPHO_CURATOR_CREATE_MARKET_URL = 'https://curator.morpho.org/markets/create';
export const MORPHO_CURATOR_CREATE_VAULT_URL = 'https://curator.morpho.org/vaults/create';
export const MORPHO_CURATOR_CREATE_FEE_WRAPPER_URL =
  'https://curator.morpho.org/fee-wrapper/create';
export const MORPHO_APP_VAULTS_URL = 'https://app.morpho.org/vaults';
export const MORPHO_LIQUIDATION_APP_URL = 'https://liquidation.morpho.org/';
export const MORPHO_DOCS_GET_STARTED_URL = 'https://docs.morpho.org/get-started/';

/** Morpho Oracle Portal — Decoder + Tester for oracle / feed validation. */
export const MORPHO_ORACLE_PORTAL_URL = 'https://oracles.morpho.dev/';

/** Muscadine fork of the Morpho bots monorepo (downstream changes live on `main`). */
export const MUSCADINE_BOTS_GITHUB_URL =
  'https://github.com/Muscadine-Labs/muscadine-bots';
export const MUSCADINE_VAULT_BOT_TELEGRAM_URL = 'https://t.me/MuscadineVaultBot';

export const MORPHO_AUTOMATION_BOTS: readonly MorphoAutomationBot[] = [
  {
    title: 'Muscadine Vault Bots (downstream)',
    description:
      'Muscadine Vault v2 allocator + sentinel + rebater bots on Base, plus Telegram alerts.',
    body: 'Muscadine-Labs/muscadine-bots — allocator, sentinel, and rebater bots with liquidityAwareUtilBand and rankedYieldWithGuards strategies. Live alerts via @MuscadineVaultBot.',
    href: MUSCADINE_BOTS_GITHUB_URL,
    telegramHref: MUSCADINE_VAULT_BOT_TELEGRAM_URL,
  },
];
