import { NextRequest, NextResponse } from "next/server";
import { isOperator } from "@/lib/operator";
import { diagnoseEngine, type LayerProbe } from "@/lib/scan";
import { DIAGNOSE_SAMPLE } from "@/lib/diagnose-sample";
import { usdRates } from "@/lib/fx";
import { redisRoundTrip } from "@/lib/redis";
import { currentSpendMode, todayModelSpend, DAILY_MODEL_BUDGET_USD } from "@/lib/model-budget";

/**
 * LIVE DIAGNOSE. Every provider the scan engine depends on, called for real,
 * with the request shapes a scan sends:
 *
 *   curl -s -H "Authorization: Bearer $ANALYTICS_TOKEN" https://<domain>/api/diagnose
 *
 * /api/preflight says whether the configuration is present. This says whether
 * it WORKS: a key can be set and still be refused, a model can be enabled and
 * still answer 400 to the request the engine builds, and a Lens plan can be
 * active and out of searches. The test suite cannot see any of that, because
 * it stubs every provider; that is how a request every Opus 5 call refused
 * shipped green. Run this after every deploy and after any provider change.
 *
 * What one run spends: three Claude calls (the gate on Opus 5 and on Sonnet
 * 5, each comparing a 320px sample with itself; the extraction on Haiku 4.5),
 * measured from the usage they report and returned as cost.claudeUsd, about
 * one cent at list prices; one SerpApi Lens search; one Serper search credit;
 * one Blob upload and delete. The SerpApi account lookup is free. The Claude
 * spend counts against the day's model budget like any other call.
 *
 * Behind the same bearer token as /api/stats and /api/preflight. Answers
 * never include a key, an email or the image.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const since = (started: number) => Date.now() - started;

async function serpApiAccount(): Promise<LayerProbe> {
  const key = process.env.SERPAPI_KEY;
  if (!key) return { layer: "serpapi account", pass: false, latencyMs: 0, status: 0, detail: "SERPAPI_KEY is not set" };
  const started = Date.now();
  try {
    const res = await fetch(`https://serpapi.com/account.json?api_key=${encodeURIComponent(key)}`, {
      signal: AbortSignal.timeout(8000),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || body.error) {
      return { layer: "serpapi account", pass: false, latencyMs: since(started), status: res.status, detail: String(body.error || res.statusText).slice(0, 300) };
    }
    const left = Number(body.total_searches_left ?? body.plan_searches_left);
    const known = Number.isFinite(left);
    return {
      layer: "serpapi account",
      pass: known ? left > 0 : true,
      latencyMs: since(started),
      status: res.status,
      detail: known ? `${left} searches left${left < 1000 ? ": top up before a traffic push" : ""}` : "the account answered without a remaining count",
      // Selected fields only. The account payload also carries the key and
      // the account email, and neither belongs in this answer.
      plan: body.plan_name ?? null,
      searchesPerMonth: body.searches_per_month ?? null,
      planSearchesLeft: body.plan_searches_left ?? null,
      totalSearchesLeft: body.total_searches_left ?? null,
      thisMonthUsage: body.this_month_usage ?? null,
      rateLimitPerHour: body.account_rate_limit_per_hour ?? null,
    };
  } catch (err) {
    return { layer: "serpapi account", pass: false, latencyMs: since(started), status: 0, detail: String((err as Error)?.message || err).slice(0, 300) };
  }
}

async function serper(): Promise<LayerProbe> {
  const key = process.env.SERPER_API_KEY;
  if (!key) return { layer: "serper", pass: false, latencyMs: 0, status: 0, detail: "SERPER_API_KEY is not set (it is the Lens and Shopping backup)" };
  const started = Date.now();
  try {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-KEY": key },
      body: JSON.stringify({ q: "ceramic table lamp", gl: "us", hl: "en", num: 1 }),
      signal: AbortSignal.timeout(8000),
    });
    const text = await res.text();
    let body: Record<string, unknown> = {};
    try { body = JSON.parse(text); } catch { /* reported below */ }
    const ok = res.ok && Array.isArray(body.organic);
    return {
      layer: "serper",
      pass: ok,
      latencyMs: since(started),
      status: res.status,
      detail: ok ? `answered; ${(body.organic as unknown[]).length} result(s)` : text.slice(0, 300),
      creditsUsed: typeof body.credits === "number" ? body.credits : null,
    };
  } catch (err) {
    return { layer: "serper", pass: false, latencyMs: since(started), status: 0, detail: String((err as Error)?.message || err).slice(0, 300) };
  }
}

async function exchangeRates(): Promise<LayerProbe> {
  const started = Date.now();
  const table = await usdRates();
  if (!table) {
    return { layer: "exchange rates", pass: false, latencyMs: since(started), status: 0, detail: "no rate table: non-dollar asking prices get no verdict until this recovers" };
  }
  const shown = ["eur", "gbp", "mad", "cad"].map(c => `${c.toUpperCase()} ${table.rates[c] ?? "missing"}`).join(", ");
  return { layer: "exchange rates", pass: !!table.rates.mad, latencyMs: since(started), status: 200, detail: `rates for ${table.date}: ${shown} per USD` };
}

async function redis(): Promise<LayerProbe> {
  const started = Date.now();
  const ok = await redisRoundTrip();
  return { layer: "redis", pass: ok, latencyMs: since(started), status: ok ? 200 : 0, detail: ok ? "write and read" : "Upstash did not answer a write and read" };
}

export async function GET(req: NextRequest) {
  if (!isOperator(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const started = Date.now();
  const [engine, account, backup, rates, store, mode, spend] = await Promise.all([
    diagnoseEngine(DIAGNOSE_SAMPLE),
    serpApiAccount(),
    serper(),
    exchangeRates(),
    redis(),
    currentSpendMode(),
    todayModelSpend(),
  ]);
  const layers = [...engine, account, backup, rates, store];
  const claudeUsd = engine.reduce((sum, p) => sum + (typeof p.costUsd === "number" ? p.costUsd : 0), 0);

  return NextResponse.json(
    {
      pass: layers.every(l => l.pass),
      failing: layers.filter(l => !l.pass).map(l => l.layer),
      ranAt: new Date().toISOString(),
      tookMs: since(started),
      spend: { mode, todayUsd: Math.round(spend * 100) / 100, dailyBudgetUsd: DAILY_MODEL_BUDGET_USD },
      cost: {
        claudeUsd: Math.round(claudeUsd * 1_000_000) / 1_000_000,
        searches: { serpapiLens: process.env.SERPAPI_KEY ? 1 : 0, serper: process.env.SERPER_API_KEY ? (process.env.SERPAPI_KEY ? 1 : 2) : 0 },
        note: "Claude cost is measured from this run's reported usage. Search cost is one search per provider at your plan's per-search price; the SerpApi account lookup is free.",
      },
      layers,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
