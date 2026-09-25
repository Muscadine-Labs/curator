# Muscadine Curator

Next.js dashboard for Muscadine vaults on Morpho.

## Quick Start (macOS)

Prerequisites: [Node.js](https://nodejs.org/) **24.x** and [Git](https://git-scm.com/). Check with:

```bash
node -v
npm -v
git --version
```

### 1. Clone from GitHub

```bash
cd ~/Desktop
git clone https://github.com/Muscadine-Labs/curator.git
cd curator
```

### 2. Install dependencies

```bash
npm install
```

### 3. Set up environment variables

Copy the example file, then edit it with your keys:

```bash
cp .env.example .env.local
open -e .env.local
```

Fill in at minimum:

```bash
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=your_walletconnect_project_id
NEXT_PUBLIC_ALCHEMY_API_KEY=your_alchemy_api_key
ALCHEMY_API_KEY=your_alchemy_api_key
CURATOR_ADMIN_PASSWORD=your_login_password
```

Get keys from [Reown Cloud](https://dashboard.reown.com/) (WalletConnect project ID) and [Alchemy](https://www.alchemy.com/). For server RPC you can use `ALCHEMY_API_KEY` or `COINBASE_CDP_API_KEY` instead of Alchemy.

### 4. Run the development server

```bash
npm run dev
```

### 5. Open the app

```bash
open http://localhost:3000
```

Or visit http://localhost:3000 in your browser.

## Environment Variables

Copy `.env.example` → `.env.local`. Summary:

| Variable | Required? | Notes |
|----------|-----------|-------|
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | **Yes in production** | Demo mode in local dev if unset |
| `ALCHEMY_API_KEY` or `COINBASE_CDP_API_KEY` | Recommended | Server RPC; demo endpoints if both missing |
| `NEXT_PUBLIC_ALCHEMY_API_KEY` | Recommended | Client RPC |
| `NEXT_PUBLIC_APP_URL` | No | Default `http://localhost:3000` |
| `NEXT_PUBLIC_SAFE_API_KEY` | No | Safe Transaction Service sync |
| `CURATOR_ADMIN_PASSWORD` | **Yes to log in** | Username is `admin` |
| `CURATOR_SESSION_SECRET` | No | Dedicated session HMAC; login password is the fallback |
| `CURATOR_SESSION_VERSION` | No | Bump to invalidate sessions |
| `CURATOR_TRUSTED_PROXY_HOPS` | **Yes in production** | Proxy count for per-IP login rate limits |
| `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` | Recommended in production | Shared login rate-limit store |
| `MORPHO_API_URL` | No | Morpho GraphQL override |
| `NEXT_PUBLIC_VAULT_*` | No | Vault address overrides |
| `SEND_ASSETS_GATE_ADDRESS` | No | Override the built-in send-assets gate |

## Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm test` - Run tests
- `npm run lint` - Run linter

## Tech Stack

- Next.js 16.3 (App Router, webpack)
- TypeScript 6
- Tailwind CSS 4 + shadcn/ui
- Wagmi 2 + Reown AppKit (wallet)
- Viem (blockchain)
- TanStack Query (data fetching)
- Vitest 4

## License

© 2026 Muscadine. Built on Base.
