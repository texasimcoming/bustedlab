import { NextResponse } from "next/server";
import {
  getTrendingProducts,
  getCategoryStats,
  getTopMarkupProducts,
  getLedgerSize,
} from "@/lib/redis";

/**
 * The leaderboards.
 *
 * Three boards, all read from the ledger, none of them seedable:
 *   most scanned this week, steepest markups ever, most expensive categories.
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

  const [trending, categories, topMarkup, ledgerSize] = await Promise.all([
    settle(() => getTrendingProducts(10), []),
    settle(() => getCategoryStats(5), []),
    settle(() => getTopMarkupProducts(10), []),
    settle(() => getLedgerSize(), 0),
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
    },
    { headers: { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=600" } }
  );
}
