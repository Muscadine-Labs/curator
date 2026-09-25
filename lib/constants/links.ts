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
  { name: 'Cloudflare', url: 'https://www.cloudflare.com/', description: 'DNS and CDN' },
];

export const MUSCADINE_BUSINESS_SERVICES: readonly ExternalLinkItem[] = [
  { name: 'Georgia Secretary of State', url: 'https://ecorp.sos.ga.gov/', description: 'ecorp.sos.ga.gov' },
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
/** Upstream implementation the fork tracks. */
export const MORPHO_BOTS_GITHUB_URL = 'https://github.com/morpho-org/morpho-bots';
export const MUSCADINE_VAULT_BOT_TELEGRAM_URL = 'https://t.me/MuscadineVaultBot';

export const MORPHO_AUTOMATION_BOTS: readonly MorphoAutomationBot[] = [
  {
    title: 'Muscadine Vault Bots (downstream)',
    description:
      'Muscadine Vault v2 allocator + sentinel + rebater bots on Base, plus Telegram alerts.',
    body: 'Muscadine-Labs/muscadine-bots — allocator, sentinel, and rebater bots with liquidityAwareUtilBand and rankedYieldWithGuards strategies. Live alerts via @MuscadineVaultBot.',
    href: MUSCADINE_BOTS_GITHUB_URL,
    telegramHref: MUSCADINE_VAULT_BOT_TELEGRAM_URL,
    upstreamRepoHref: MORPHO_BOTS_GITHUB_URL,
  },
  {
    title: 'Morpho Bots (upstream)',
    description:
      'Upstream Morpho curator bots monorepo — Blue liquidation, Midnight bots, and shared bot-kit runtime.',
    body: 'Unified bun workspaces monorepo for Morpho off-chain curator bots: blue-liquidation, midnight-liquidation, kill-switch, and shared packages (@repo/bot-kit, @repo/swaps, @repo/contracts). Upstream source for the Muscadine fork.',
    href: MORPHO_BOTS_GITHUB_URL,
  },
];
