import type { NextConfig } from "next";

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
            value: "geolocation=(), microphone=(), payment=(), interest-cohort=()",
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
            value: [
              "default-src 'self'",
              // Next injects inline bootstrap and hydration scripts.
              "script-src 'self' 'unsafe-inline'",
              // Every style in this app is an inline style attribute.
              "style-src 'self' 'unsafe-inline'",
              // Product photos arrive through /api/proxy-image (same origin);
              // data: covers the fallback pixel and the share-card canvas.
              "img-src 'self' data: blob:",
              // Fonts are self-hosted at build time, not fetched from Google.
              "font-src 'self'",
              "connect-src 'self'",
              "media-src 'self' data:",
              // The verdict tone is generated with the Web Audio API, and the
              // share card is rendered to a canvas; neither needs a worker,
              // an object, or an embed.
              "worker-src 'self' blob:",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              // Matches the X-Frame-Options above, which older browsers read.
              "frame-ancestors 'none'",
              "upgrade-insecure-requests",
            ].join("; "),
          },
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
