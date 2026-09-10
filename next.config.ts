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
