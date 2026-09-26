import type { NextConfig } from "next";

import { checkoutFrameOrigins } from "./src/lib/csp";

// Checkout origins for the payment delegation below: Lemon Squeezy, plus a
// custom checkout domain if CHECKOUT_URL uses one. Read at build time;
// Vercel rebuilds on every environment change, so this cannot drift from
// CHECKOUT_URL.
//
// The Content-Security-Policy is not set here. It carries a per-request
// nonce, so src/proxy.ts builds it for every page; see src/lib/csp.ts.
const CHECKOUT_FRAME_ORIGINS = checkoutFrameOrigins();

const nextConfig: NextConfig = {
  // Every external image in the app is relayed through /api/proxy-image, which
  // does its own SSRF validation, size cap, content-type check and caching.
  // next/image is never pointed at a remote host.
  //
  // The previous config allowed `remotePatterns: [{ protocol: "http"|"https",
  // hostname: "**" }]` for a feature nothing uses. That turns the built-in
  // image optimizer into a second, unguarded open proxy sitting next to the
  // guarded one, reachable at /_next/image?url=... by anyone. Removing the
  // patterns closes it: with no remote patterns configured, the optimizer
  // refuses every external URL.
  images: {
    remotePatterns: [],
  },

  // Security headers. None of these were set before.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // The app is never framed. Clickjacking a one-click purchase flow is
          // the obvious attack.
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Full URLs leak the scanned product URL to every outbound link the
          // results page offers, including the merchant being analysed.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            // Camera stays available: "LIVE SCAN" opens the device camera
            // through a file input with capture, which needs it.
            //
            // payment was "()" - disabled for this page AND every frame it
            // embeds. That was harmless while checkout was a full-page
            // redirect, because the header stopped applying the moment the
            // visitor left this origin. Inside an overlay it would have
            // switched off the Payment Request API in the checkout iframe,
            // which is what Apple Pay and Google Pay run on: the one-tap
            // wallets would silently vanish from the embedded checkout, on
            // exactly the mobile traffic this site lives on, while the page
            // says "Card, Apple Pay and Google Pay" directly above the
            // button. Delegated to the checkout origins only.
            value: [
              "geolocation=()",
              "microphone=()",
              `payment=(self ${CHECKOUT_FRAME_ORIGINS.map(o => `"${o}"`).join(" ")})`,
              "interest-cohort=()",
            ].join(", "),
          },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
        ],
      },
      {
        // The one page allowed to be framed, and only by this origin.
        //
        // Lemon Squeezy's confirmation modal - "You're in." - carries a
        // button to /success. Whether that button navigates the whole page
        // or only the checkout iframe is decided inside Lemon Squeezy's code
        // and could not be confirmed from here. If it is the iframe, a
        // blanket X-Frame-Options: DENY would render a blocked frame at the
        // exact moment someone has just paid. SAMEORIGIN still refuses every
        // other site - which is what stops clickjacking - and /success lifts
        // itself out to the top level if it ever finds itself framed, so the
        // buyer lands on a real page either way. The header overrides the
        // global one above because Next applies matching rules in order and
        // the later value for the same key wins.
        source: "/success",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          // The CSP makes the same exception for this path, in src/proxy.ts.
        ],
      },
      {
        // The page a sign-in link opens. Its address carries the token, so it
        // is never cached and never sends the address onward as a referrer.
        source: "/auth/verify",
        headers: [
          { key: "Cache-Control", value: "no-store" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
      {
        // Same for the unsubscribe page: its address carries the email and
        // the token that removes it from the list.
        source: "/unsubscribe",
        headers: [
          { key: "Cache-Control", value: "no-store" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
      {
        // Auth and purchase endpoints must never be cached by a CDN or a
        // browser. A cached /api/scan response would hand one visitor's
        // free-scan state to the next.
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store, must-revalidate" }],
      },
      {
        // The one exception: proxied product images are immutable content
        // worth caching hard, and the route sets its own matching header.
        source: "/api/proxy-image",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400, s-maxage=86400" }],
      },
      {
        // Public leaderboard data, identical for every visitor and containing
        // nothing personal. Without this exception the blanket no-store above
        // would force a Redis read for every person who loads the homepage.
        source: "/api/leaderboard",
        headers: [{ key: "Cache-Control", value: "public, s-maxage=120, stale-while-revalidate=600" }],
      },
    ];
  },
};

export default nextConfig;
