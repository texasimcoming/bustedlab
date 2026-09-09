import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { buildFunnel, readEvents, CLIENT_EVENTS } from "@/lib/analytics";
import { getLedgerSize } from "@/lib/redis";

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

function authorized(req: NextRequest): boolean {
  const secret = process.env.ANALYTICS_TOKEN;
  if (!secret) return false;

  const header = req.headers.get("authorization") || "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const requested = Number(req.nextUrl.searchParams.get("days") || 30);
  const days = Math.min(Math.max(Number.isFinite(requested) ? requested : 30, 1), 120);

  const [series, ledgerSize] = await Promise.all([
    readEvents(days),
    getLedgerSize().catch(() => 0),
  ]);

  return NextResponse.json(
    {
      windowDays: days,
      ledgerSize,
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
