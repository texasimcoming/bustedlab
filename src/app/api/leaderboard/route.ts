import { NextResponse } from "next/server";
import {
  getTrendingProducts,
  getCategoryStats,
  getTopMarkupProducts,
  getRecentRecords,
  getLedgerSize,
  getTopSavingsProducts,
} from "@/lib/redis";
import { REAL_CATCHES_MINIMUM } from "@/content/catches";

/**
 * The leaderboards.
 *
 * Three boards, all read from the ledger, none of them seedable:
 *   most scanned this week, steepest markups ever, most expensive categories.
 *
 * Plus `recent`: the latest measurements, which the activity toast on the
 * landing page uses once there is enough real data to stop falling back to
 * placeholder toasts. Two filters on it. Cached repeat scans are excluded,
 * because a repeat answered from the 24-hour cache is real demand but not an
 * independent measurement of the price, and every one of these is shown as a
 * measured finding. And nothing about the scanner is included, only the
 * product and its numbers, which are already public at finer grain on each
 * scan's own permanent page.
 *
 * And `catches`: "What we catch" on the landing page, the biggest verified
 * savings one per product, sent only once at least REAL_CATCHES_MINIMUM
 * products qualify (the page shows its labelled illustrative set until then).
 * The same fields The Index already shows for each record, nothing more.
 *
 * Public and identical for every visitor, so it is cached at the edge. The
 * blanket no-store on /api/* exists to stop one person's free-scan state being
 * served to the next; there is nothing personal in here, and a leaderboard
 * that hits Redis once per visitor is a leaderboard that costs money to look
 * at. next.config.ts carries the matching exception for this path.
 */
export const revalidate = 120;

export async function GET() {
  const settle = async <T,>(fn: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await fn();
    } catch {
      return fallback;
    }
  };

  const [trending, categories, topMarkup, recent, ledgerSize, catches] = await Promise.all([
    settle(() => getTrendingProducts(10), []),
    settle(() => getCategoryStats(5), []),
    settle(() => getTopMarkupProducts(10), []),
    // Over-fetched, because the cached-repeat filter below removes some.
    settle(() => getRecentRecords(24), []),
    settle(() => getLedgerSize(), 0),
    settle(() => getTopSavingsProducts(REAL_CATCHES_MINIMUM), []),
  ]);

  return NextResponse.json(
    {
      ledgerSize,
      trending: trending.map(t => ({
        title: t.title,
        scans: t.scans,
        maxMarkup: t.maxMarkup,
        id: t.lastId,
      })),
      topMarkup: topMarkup.map(r => ({
        title: r.title,
        markup: r.markup,
        savings: r.savings,
        id: r.id,
      })),
      categories: categories.map(c => ({
        category: c.category,
        averageMarkup: c.averageMarkup,
        count: c.count,
      })),
      recent: recent
        .filter(r => !r.cached && r.savings > 0 && r.markup > 0)
        .slice(0, 12)
        .map(r => ({
          title: r.title,
          markup: r.markup,
          savings: r.savings,
          id: r.id,
        })),
      catches: catches.length < REAL_CATCHES_MINIMUM ? [] : catches.map(r => ({
        id: r.id,
        title: r.title,
        category: r.category,
        retailPrice: r.retailPrice,
        wholesalePrice: r.wholesalePrice,
        savings: r.savings,
      })),
    },
    { headers: { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=600" } }
  );
}
