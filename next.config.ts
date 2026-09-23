import type { NextConfig } from "next";

// ── Checkout origins, for the headers below. ──
// The overlay checkout is an iframe on Lemon Squeezy's domain, or on a custom
// checkout domain if the store has one. The configured link's own origin is
// read here at build time so a custom domain is covered too; Vercel rebuilds
// on every environment change, so this cannot drift from CHECKOUT_URL.
function checkoutOrigin(): string | null {
  try {
    const raw = (process.env.CHECKOUT_URL || "").trim();
    return raw ? new URL(raw).origin : null;
  } catch {
    return null;
  }
}
const LEMON_ORIGINS = ["https://*.lemonsqueezy.com"];
const CHECKOUT_FRAME_ORIGINS = [...LEMON_ORIGINS, checkoutOrigin()].filter(
  (origin, i, all): origin is string => !!origin && all.indexOf(origin) === i
);
// lemon.js itself. The spec named assets.lemonsqueezy.com; Lemon Squeezy's
// own Next.js template loads from app.lemonsqueezy.com. Both are allowed
// because src/lib/lemon-overlay.ts tries both.
const LEMON_SCRIPT_ORIGINS = ["https://assets.lemonsqueezy.com", "https://app.lemonsqueezy.com"];

// The report-only Content-Security-Policy, built once so the site-wide copy
// and the /success copy cannot drift apart. They differ only in who may
// frame the page. See the note on the header itself for why it is report-
// only for now.
function contentSecurityPolicy(frameAncestors: "'none'" | "'self'"): string {
  return [
    "default-src 'self'",
    // Next injects inline bootstrap and hydration scripts.
    // Plus lemon.js, which loads only when checkout intent appears.
    `script-src 'self' 'unsafe-inline' ${LEMON_SCRIPT_ORIGINS.join(" ")}`,
    // The overlay checkout is an iframe on the provider's origin.
    `frame-src 'self' ${CHECKOUT_FRAME_ORIGINS.join(" ")}`,
    // Every style in this app is an inline style attribute.
    "style-src 'self' 'unsafe-inline'",
    // Product photos arrive through /api/proxy-image (same origin);
    // data: covers the fallback pixel and the share-card canvas.
    "img-src 'self' data: blob:",
    // Fonts are self-hosted at build time, not fetched from Google.
    "font-src 'self'",
    `connect-src 'self' ${LEMON_ORIGINS.join(" ")}`,
    "media-src 'self' data:",
    // The verdict tone is generated with the Web Audio API, and the
    // share card is rendered to a canvas; neither needs a worker,
    // an object, or an embed.
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // Matches the X-Frame-Options above, which older browsers read.
    `frame-ancestors ${frameAncestors}`,
    // No upgrade-insecure-requests: browsers ignore it in a report-only
    // policy and log a console error on every page load saying so. Add it
    // back when this policy is enforced. Strict-Transport-Security already
    // keeps the site itself on https.
  ].join("; ");
}

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
          // ── Content-Security-Policy, REPORT ONLY for now. ──
          //
          // Report-only cannot break a page: browsers evaluate it and log
          // violations to the console without blocking anything. That is the
          // point of shipping it first. A CSP that is enforced before anyone
          // has seen real violation data is how a site goes blank in
          // production, and this app renders every style as an inline style
          // attribute and relies on Next's inline hydration scripts, so the
          // directives below are a hypothesis, not a finished policy.
          //
          // What to do with it: load the site, open the console, and read the
          // violations. Expect to see the inline script and style entries
          // exercised. Then either tighten those two into a nonce-based
          // policy (which needs middleware to stamp a per-request nonce onto
          // Next's script tags) or accept 'unsafe-inline' for styles only and
          // enforce the rest by renaming this header to
          // Content-Security-Policy.
          //
          // No report-uri: there is no collection endpoint, and adding one
          // would mean accepting unauthenticated POSTs from every browser on
          // the internet. The console is the right place to read this from
          // while it is a diagnostic rather than a control.
          {
            key: "Content-Security-Policy-Report-Only",
            value: contentSecurityPolicy("'none'"),
          },
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
          // The same policy, framable by this origin, so enforcing the CSP
          // later cannot quietly re-break the post-purchase page.
          { key: "Content-Security-Policy-Report-Only", value: contentSecurityPolicy("'self'") },
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
