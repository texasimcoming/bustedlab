import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // We use our own image proxy (/api/proxy-image) for all external images
    // so next/image domain restrictions don't apply to product thumbnails.
    // This config covers any direct next/image usage.
    remotePatterns: [
      { protocol: "https", hostname: "**" },
      { protocol: "http", hostname: "**" },
    ],
  },
  // Ensure the image proxy route is not cached aggressively
  async headers() {
    return [
      {
        source: "/api/proxy-image",
        headers: [
          { key: "Cache-Control", value: "public, max-age=86400, s-maxage=86400" },
        ],
      },
    ];
  },
};

export default nextConfig;
