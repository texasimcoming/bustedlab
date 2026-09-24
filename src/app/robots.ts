import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const base = (process.env.NEXT_PUBLIC_BASE_URL || "https://bustedlab.com").replace(/\/$/, "");
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Nothing under /api is a page. /auth and /success are transactional
        // states that mean nothing to a crawler and should never be a search
        // result someone lands on.
        disallow: ["/api/", "/auth/", "/success", "/login"],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
