import { NextRequest, NextResponse } from "next/server";
import { buildFunnel, readEvents, readEventsBySource, readScanCosts, readScanFailures, readWrongProduct, CLIENT_EVENTS } from "@/lib/analytics";
import { getLedgerSize, readCspViolations, readGlobalScansHistory, GLOBAL_DAILY_CAP } from "@/lib/redis";
import { readModelSpendHistory, currentSpendMode, DAILY_MODEL_BUDGET_USD } from "@/lib/model-budget";
import { serperCreditsLeft, serpApiSearchesLeft } from "@/lib/provider-balance";
import { isOperator } from "@/lib/operator";

/**
 * The read side. Protected, because this is the business.
 *
 * Scan volume, verdict mix and conversion rates are the numbers a competitor
 * would most like to have and the numbers that most clearly say how old this
 * company is. Everything else on the site is deliberately public; this is the
 * one endpoint that is not.
 *
 * Authenticated by a bearer token in ANALYTICS_TOKEN and fails closed: with no
 * token configured there is no way in at all, rather than a default that
 * somebody forgets to change.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!isOperator(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const requested = Number(req.nextUrl.searchParams.get("days") || 30);
  const days = Math.min(Math.max(Number.isFinite(requested) ? requested : 30, 1), 120);

  const [series, ledgerSize, csp, failures, wrongProduct, spendDays, scanDays, mode, serper, serpapi, scanCosts, bySource] = await Promise.all([
    readEvents(days),
    getLedgerSize().catch(() => 0),
    readCspViolations(days).catch(() => []),
    readScanFailures(days),
    readWrongProduct(days),
    readModelSpendHistory(days),
    readGlobalScansHistory(days),
    currentSpendMode(),
    serperCreditsLeft(),
    serpApiSearchesLeft(),
    readScanCosts(days),
    readEventsBySource(days),
  ]);

  return NextResponse.json(
    {
      windowDays: days,
      ledgerSize,
      // What the Content-Security-Policy blocked, per day, by kind:
      // "<enforce|report> <directive> <what was blocked> <page>". Empty is
      // the healthy state. Anything counted here under "enforce" is
      // something a visitor's browser refused to run or load; see
      // src/lib/csp.ts. Kept 35 days.
      csp,
      // Scans the server could not complete because a provider failed, by
      // the layer that failed, plus the last fifty with the failing
      // layer:provider:model:status. A non-zero "gate" or "extraction" is a
      // Claude API problem; "lens" or "shopping" a search provider one. The
      // browser-side scan_failed (timeouts) is in the funnel, not here.
      failures,
      // "Wrong product? Tell us" reports: one per scan, by the result's mode
      // and match confidence, plus the last fifty. Ground-truth labels for
      // the identification engine; a report is the person's word, rate
      // limited, not proof.
      wrongProduct,
      // Spend against the caps, per UTC day: measured model spend (every
      // Claude call, as its usage reported it) and the uncached free scans
      // the global cap counted. Kept 400 days.
      spend: {
        mode,
        dailyModelBudgetUsd: DAILY_MODEL_BUDGET_USD,
        globalDailyFreeScanCap: GLOBAL_DAILY_CAP,
        days: spendDays.map((d, i) => ({ ...d, uncachedFreeScans: scanDays[i]?.uncachedFreeScans ?? 0 })),
      },
      // What uncached visitor scans cost, per UTC day and over the window:
      // scans that reached the engine, how many ended "Product not
      // identified", the SerpApi Lens escalation (fired; then rescued a
      // match or still nothing; or skipped at the reserve, for time, or for
      // another reason), SerpApi searches spent, and Claude cost per scan,
      // escalated against not. Evaluation scans and cache hits are not in
      // it. Kept 400 days.
      scanCosts,
      // What the search accounts have left (free lookups; numbers only).
      providers: { serperCreditsLeft: serper.known ? serper.left : null, serpApiSearchesLeft: serpapi.known ? serpapi.left : null },
      // The browser-side funnel over the window, by the channel that brought
      // the visit (src/lib/source.ts). Counts sent before channels existed
      // are in the totals only.
      bySource,
      window: buildFunnel(series, "window"),
      lifetime: buildFunnel(series, "total"),
      series: series.map(s => ({
        event: s.event,
        total: s.total,
        windowTotal: s.windowTotal,
        // Server-observed events cannot be forged from outside. The browser
        // ones can be, within the rate limit. Anyone reading a funnel needs to
        // know which half of it is evidence.
        source: (CLIENT_EVENTS as readonly string[]).includes(s.event) ? "client" : "server",
        days: s.days,
      })),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
