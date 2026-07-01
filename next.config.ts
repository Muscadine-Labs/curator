import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@rainbow-me/rainbowkit",
    "wagmi",
    "@wagmi/core",
    "@wagmi/connectors",
  ],
  // Use webpack for builds to support alias configuration
  // Turbopack doesn't support false aliases yet
  webpack: (config) => {
    const valtioRoot = path.dirname(require.resolve("valtio/package.json"));
    // Silence optional deps required by walletconnect/metamask in browser builds
    config.resolve = config.resolve || {};
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      "valtio/vanilla/utils": path.join(valtioRoot, "vanilla/utils.js"),
      "valtio/vanilla": path.join(valtioRoot, "vanilla.js"),
      "valtio/react": path.join(valtioRoot, "react.js"),
      valtio: valtioRoot,
      "pino-pretty": false,
      "@react-native-async-storage/async-storage": false,
    };
    // viem → ox (Tempo chain) via @safe-global/api-kit: dynamic require in a dependency.
    // Harmless for our Safe proposer route; silences "Compiled with warnings" on Vercel.
    config.ignoreWarnings = [
      ...(Array.isArray(config.ignoreWarnings) ? config.ignoreWarnings : []),
      {
        module: /node_modules[\\/]ox[\\/]_esm[\\/]tempo[\\/]internal[\\/]virtualMasterPool\.js/,
        message: /Critical dependency: the request of a dependency is an expression/,
      },
    ];
    return config;
  },
  // Performance optimizations
  compress: true,
  poweredByHeader: false,
  // Optimize images
  images: {
    formats: ['image/avif', 'image/webp'],
  },
  // Security headers
  async headers() {
    const safeAppCorsHeaders = [
      {
        key: 'Access-Control-Allow-Origin',
        value: '*',
      },
      {
        key: 'Access-Control-Allow-Methods',
        value: 'GET',
      },
      {
        key: 'Access-Control-Allow-Headers',
        value: 'X-Requested-With, content-type, Authorization',
      },
    ];

    return [
      {
        source: '/manifest.json',
        headers: [
          ...safeAppCorsHeaders,
          {
            key: 'Content-Security-Policy',
            value: "frame-ancestors 'self' https://app.safe.global",
          },
        ],
      },
      {
        source: '/muscadinelogo.svg',
        headers: safeAppCorsHeaders,
      },
      {
        source: '/muscadinelogo.jpg',
        headers: safeAppCorsHeaders,
      },
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'on',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          {
            key: 'Content-Security-Policy',
            value: "frame-ancestors 'self' https://app.safe.global",
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
          // same-origin breaks Base Account SDK + other wallet popups (window.opener messaging).
          // Base recommends same-origin-allow-popups: https://docs.base.org/base-account/more/troubleshooting/usage-details/popups
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin-allow-popups',
          },
        ],
      },
    ];
  },
  // Experimental features for better performance
  experimental: {
    optimizePackageImports: ['recharts', 'lucide-react', '@radix-ui/react-tabs'],
  },
  async redirects() {
    return [
      { source: '/curator/markets', destination: '/markets', permanent: true },
      { source: '/curator/market/blue/:id', destination: '/market/blue/:id', permanent: true },
      { source: '/curator/safe', destination: '/safe/allocator', permanent: true },
      { source: '/curator/safe/:role', destination: '/safe/:role', permanent: true },
      { source: '/curator/morpho', destination: '/morpho', permanent: true },
      { source: '/curator/cctp', destination: '/morpho', permanent: true },
      { source: '/overview/monthly-statement', destination: '/monthly-statement', permanent: true },
      { source: '/overview/muscadine-ledger', destination: '/muscadine-ledger', permanent: true },
      { source: '/overview/muscadine-frontends', destination: '/muscadine-frontends', permanent: true },
      { source: '/vault/v2/:address', destination: '/vault/:address', permanent: true },
      { source: '/api/curator/markets', destination: '/api/markets', permanent: true },
      { source: '/api/curator/markets/:marketId', destination: '/api/markets/:marketId', permanent: true },
      { source: '/api/vaults/v2/:id/risk', destination: '/api/vaults/:id/risk', permanent: true },
      { source: '/api/vaults/v2/:id/governance', destination: '/api/vaults/:id/governance', permanent: true },
      { source: '/api/vaults/v2/:id/pending', destination: '/api/vaults/:id/pending', permanent: true },
    ];
  },
};

export default nextConfig;
