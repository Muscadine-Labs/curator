# Muscadine Curator

Next.js dashboard for Muscadine vaults on Morpho. Built on Base network.

## Quick Start (macOS)

Prerequisites: [Node.js](https://nodejs.org/) (LTS) and [Git](https://git-scm.com/). Check with:

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
```

Get keys from [WalletConnect Cloud](https://cloud.walletconnect.com) and [Alchemy](https://www.alchemy.com/). For server RPC you can use `ALCHEMY_API_KEY` or `COINBASE_CDP_API_KEY` instead of Alchemy.

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

### Required

- `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` - Get from https://cloud.walletconnect.com
- `NEXT_PUBLIC_ALCHEMY_API_KEY` - Get from https://www.alchemy.com/
- `ALCHEMY_API_KEY` OR `COINBASE_CDP_API_KEY` - Server-side RPC (one required)

### Optional

All other variables have defaults. See `.env.example` for full list.

## Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm test` - Run tests
- `npm run lint` - Run linter

## Tech Stack

- Next.js 15 (App Router)
- TypeScript
- Tailwind CSS + shadcn/ui
- Wagmi + RainbowKit (wallet)
- Viem (blockchain)
- React Query (data fetching)

## License

© 2026 Muscadine. Built on Base.
