import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import { Analytics } from "@vercel/analytics/next";
import "@/lib/wallet/polyfill-indexeddb";
import "./globals.css";
import { Providers } from "./providers";
import { logEnvValidation } from "@/lib/utils/env-validation";

// Validate environment variables at startup
if (typeof window === 'undefined') {
  // Only run on server-side
  logEnvValidation();
}

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Muscadine Curator",
  description: "Explore Muscadine vaults and track performance",
  icons: {
    icon: "/muscadinelogo.jpg",
    apple: "/muscadinelogo.jpg",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const themeScript = `(function(){var t=localStorage.getItem('curator-theme');var d=document.documentElement;if(t==='dark')d.classList.add('dark');else if(t==='light')d.classList.remove('dark');else d.classList.toggle('dark',window.matchMedia('(prefers-color-scheme: dark)').matches);})();`;
  const headersList = await headers();
  const cookies = headersList.get('cookie');

  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <Providers cookies={cookies}>
          {children}
        </Providers>
        <Analytics />
      </body>
    </html>
  );
}
