import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import { Inter, Space_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// Self-hosted at build time rather than pulled from fonts.googleapis.com on
// every page load. Three reasons, in order of weight:
//  1. The stylesheet link was render-blocking and third-party, so first paint
//     waited on a DNS lookup, a TLS handshake and a redirect to a CDN nobody
//     here controls.
//  2. A brand that has to feel permanent should not have its typography
//     depend on a third party being reachable.
//  3. It removes a request that carries the visitor's IP and referrer to
//     Google on every page view, which the privacy policy would otherwise
//     have to disclose.
// The families are exposed as CSS variables; every inline style in the app
// references those variables rather than a literal family name.
const inter = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800", "900"],
  variable: "--font-sans",
  display: "swap",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

// The monospace face carries every telemetry readout on the site, so it is
// pinned rather than left to whatever the device calls "monospace" (which is
// Courier on a surprising number of Android builds and wrecks the HUD).
const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-mono",
  display: "swap",
});

// Every verdict card that gets shared travels as a link as well as an image,
// and a link with no preview card is a link nobody clicks. The previous
// metadata had no metadataBase, no og:image and no twitter card at all, which
// meant the entire growth loop terminated at a blank grey rectangle in
// iMessage, Discord, WhatsApp and X.
const SITE_URL = process.env.NEXT_PUBLIC_BASE_URL || "https://bustedlab.com";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "BustedLab",
    template: "%s | BustedLab",
  },
  description:
    "Scan any product. Get the source price, the asking price, and the exact distance between them.",
  applicationName: "BustedLab",
  keywords: ["product price check", "markup scanner", "wholesale price lookup", "dropshipping check"],
  alternates: { canonical: "/" },
  openGraph: {
    title: "They built the price. We built the scanner.",
    description:
      "Scan any product. Get the source price, the asking price, and the exact distance between them.",
    url: "/",
    siteName: "BustedLab",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "They built the price. We built the scanner.",
    description: "Scan any product. The source price, the asking price, and the gap.",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large" },
  },
  icons: {
    icon: [
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
  // No author, publisher, or generator field. Nothing here should identify
  // who built this or when.
};

// Prevents iOS Safari from auto-zooming the whole page when an input is
// focused (it does this whenever the focused field's font-size is under
// 16px). maximumScale stops the zoom without requiring any input on the
// page to actually render at 16px, so nothing has to visually change to
// fix it.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Every page is rendered per request, because every page carries a fresh
  // CSP nonce (src/proxy.ts) and Next can only put it on the scripts of a
  // page it renders now. A page prerendered at build time would be served
  // with scripts that have no nonce under a header that demands one, and
  // nothing on it would run. The expensive part of the data pages - the
  // Redis reads - is cached separately with unstable_cache, so this costs
  // render time, not database load.
  await connection();
  return (
    <html lang="en" className={`${inter.variable} ${spaceGrotesk.variable} ${mono.variable}`}>
      <head>
        <meta name="theme-color" content="#07070e" />
      </head>
      <body>{children}</body>
    </html>
  );
}
