import type { MetadataRoute } from "next";
import { getRecentRecords } from "@/lib/redis";

/**
 * The sitemap is the delivery mechanism for the whole SEO thesis.
 *
 * Every confirmed verdict is a page answering the exact question somebody is
 * typing into Google about that exact product, and none of them are reachable
 * by a crawler that only ever sees the homepage. This hands the crawler the
 * ledger.
 *
 * Bounded at 5000 URLs, which is a hard protocol limit worth respecting well
 * before it bites: past that, this becomes a sitemap index with
 * generateSitemaps() sharding by date. Cached for an hour, because a crawler
 * hitting an uncached full-ledger read is a self-inflicted bill.
 */
export const revalidate = 3600;

const MAX_SCAN_URLS = 5000;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = (process.env.NEXT_PUBLIC_BASE_URL || "https://bustedlab.com").replace(/\/$/, "");

  const stat: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: "daily", priority: 1 },
    { url: `${base}/the-index`, changeFrequency: "hourly", priority: 0.9 },
    { url: `${base}/terms`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${base}/privacy`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${base}/dmca`, changeFrequency: "yearly", priority: 0.1 },
  ];

  let records: Awaited<ReturnType<typeof getRecentRecords>> = [];
  try {
    records = await getRecentRecords(MAX_SCAN_URLS);
  } catch {
    // A sitemap that fails is worse than a short one: the static routes still
    // ship rather than the whole file 500ing.
  }

  const scans: MetadataRoute.Sitemap = records
    // Cached repeats point at the same product as a measurement that is already
    // in here. Submitting both is duplicate content by construction.
    .filter(r => !r.cached)
    .map(r => ({
      url: `${base}/scan/${r.id}`,
      lastModified: new Date(r.ts),
      changeFrequency: "monthly" as const,
      // Records never change, so a steep markup is worth more crawl budget
      // than a fair one: it is the page people are actually searching for.
      priority: r.verdict === "HIGH_MARKUP" ? 0.8 : 0.5,
    }));

  return [...stat, ...scans];
}
