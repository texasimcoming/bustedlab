import { NextRequest, NextResponse } from "next/server";
import { scanProduct, scanProductUrl, buildShippingNote, type ScanResult } from "@/lib/scan";
import { resignProxyPath } from "@/lib/image-proxy";
import {
  freeScansRemaining,
  getTotalScans,
  getTotalSavingsExposed,
  getHourlyScans,
  isPaidUser,
  getSessionEmail,
  getGlobalScansToday,
  GLOBAL_DAILY_CAP,
  FREE_SCANS_PER_DAY,
  PAID_DAILY_SCAN_CEILING,
  getPaidScansToday,
  getCachedScan,
  fingerprintUrl,
  fingerprintImage,
  getMaxMarkup,
  getBustedRate,
  MARKUP_FLOOR,
  recordScan,
  newScanId,
} from "@/lib/redis";
import { after } from "next/server";
import { recordScanCost, recordScanFailure, scanCostFacts, type FailureReason } from "@/lib/analytics";
import { countCompletedScan } from "@/lib/scan-counters";
import { withAffiliateLink } from "@/lib/affiliate";
import { isEvaluationRequest, logEvaluationUse } from "@/lib/eval-log";
import { summarizeTrace, type ScanTrace } from "@/lib/scan-trace";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import crypto from "crypto";

// The engine budgets itself 85 seconds (SCAN_BUDGET_MS in scan.ts): both
// models think on every call, so extraction, Lens and the verification gate
// take longer than they did with thinking off. This leaves room above that
// for the call still in flight when the budget runs out. With Fluid compute
// (the default for projects created since April 2025) Vercel allows up to
// 300s on Hobby and 800s on Pro; the product must be on Pro anyway, since
// Hobby is for non-commercial use. If scans time out in production, compare
// /api/diagnose's per-call latencies with the budgets in scan.ts first.
export const maxDuration = 120;

const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

// ════════════════════════════════════════════════════════════════
// Burst limit, applied to EVERY caller including signed-in paid ones.
//
// The daily cap protects the month's budget. This protects the next sixty
// seconds: a single script pointed at this endpoint can otherwise issue
// thousands of scans before any daily counter reacts, and each uncached scan
// spends real money across four paid APIs. Paid access is a licence to scan
// as much as a person can scan, not as fast as a machine can loop, and a
// leaked session cookie should not be able to run up a bill.
//
// A limiter that cannot reach Redis fails open: a Redis outage must degrade
// to "no burst protection", never to "nobody can scan".
//
// Two limits, for the same reason the free allowance is per browser: many
// people can share one IP address. Each browser gets SCAN_BURST_PER_MINUTE;
// each address gets five times that, which a crowd behind one carrier
// address does not reach and which still stops a script inventing a new
// cookie for every request.
// ════════════════════════════════════════════════════════════════
const BURST_LIMIT = Number(process.env.SCAN_BURST_PER_MINUTE || 12);
const ADDRESS_BURST_LIMIT = BURST_LIMIT * 5;

const limiters = new Map<string, Ratelimit | null>();
function getLimiter(prefix: string, perMinute: number): Ratelimit | null {
  if (limiters.has(prefix)) return limiters.get(prefix)!;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  const limiter = url && token
    ? new Ratelimit({
        redis: new Redis({ url, token }),
        limiter: Ratelimit.slidingWindow(perMinute, "60 s"),
        prefix,
        analytics: false,
      })
    : null;
  limiters.set(prefix, limiter);
  return limiter;
}

async function underLimit(limiter: Ratelimit | null, identifier: string): Promise<boolean> {
  if (!limiter) return true;
  try {
    return (await limiter.limit(identifier)).success;
  } catch {
    return true;
  }
}

async function withinBurstLimit(ip: string, browserId: string | null): Promise<boolean> {
  const [browser, address] = await Promise.all([
    underLimit(getLimiter("scan:burst", BURST_LIMIT), browserId ? `browser:${browserId}` : ip),
    underLimit(getLimiter("scan:burst-ip", ADDRESS_BURST_LIMIT), ip),
  ]);
  return browser && address;
}

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

// Browser fingerprint from cookie. Persists across the IP changes that are
// normal on mobile networks, which is the hole a pure IP limit leaves open.
async function getBrowserId(req: NextRequest): Promise<string | null> {
  const value = req.cookies.get("bl_bid")?.value || "";
  // Only the shape this route issues. Anything else is treated as no cookie,
  // which falls back to the strict per-address allowance.
  return /^[0-9a-f]{32}$/.test(value) ? value : null;
}

function newBrowserId(): string {
  return crypto.randomBytes(16).toString("hex");
}

// ════════════════════════════════════════════════════════════════
// Access resolution.
//
// The bl_session cookie holds a random SESSION TOKEN, not an email — that
// is what /api/auth writes into it. The previous version of this route
// passed the cookie value straight to isPaidUser(), which looked up the key
// `paid:<random hex>`, which never exists. The effect was that every
// customer who paid $4.99 was still treated as an anonymous free user and
// throttled to two scans a day. The token has to be exchanged for the email
// first, which is what getSessionEmail does.
// ════════════════════════════════════════════════════════════════
async function paidScansRemaining(email: string | null): Promise<number> {
  if (!email) return PAID_DAILY_SCAN_CEILING;
  try {
    return Math.max(0, PAID_DAILY_SCAN_CEILING - (await getPaidScansToday(email)));
  } catch {
    // Fail open, like every other limit on this route: a Redis outage must
    // not lock out a paying customer. The dollar budget in model-budget.ts
    // is the backstop that does not depend on this database.
    return PAID_DAILY_SCAN_CEILING;
  }
}

async function resolveAccess(req: NextRequest): Promise<{ email: string | null; isPaid: boolean }> {
  const sessionToken = req.cookies.get("bl_session")?.value;
  if (!sessionToken) return { email: null, isPaid: false };
  try {
    const email = await getSessionEmail(sessionToken);
    if (!email) return { email: null, isPaid: false };
    return { email, isPaid: await isPaidUser(email) };
  } catch {
    return { email: null, isPaid: false };
  }
}


// GET — free-tier state plus the real public counters behind the landing page
export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  const existingBrowserId = await getBrowserId(req);
  // A first visit has no browser id yet; this response issues it. The
  // allowance shown must be the one that new browser will have, not the
  // cookieless per-address rule, or the first page anyone behind a busy
  // shared address sees says their free scans are already spent.
  const issuedBrowserId = existingBrowserId ? null : newBrowserId();
  const browserId = existingBrowserId ?? issuedBrowserId;
  const { email, isPaid } = await resolveAccess(req);

  const withBrowserCookie = (res: NextResponse) => {
    // Issued on the first page load rather than on the first scan, so the
    // limit is already anchored to a browser before any API spend happens.
    if (issuedBrowserId) {
      res.cookies.set("bl_bid", issuedBrowserId, {
        maxAge: 60 * 60 * 24 * 30,
        httpOnly: true,
        sameSite: "lax",
        secure: true,
        path: "/",
      });
    }
    return res;
  };

  // Each counter resolves independently. A single Promise.all meant one slow
  // or failing key took the whole payload down to zeros, which the landing
  // page renders as INDEXING across every tile: a transient Redis blip made
  // the site look like it had never been used.
  const settle = async <T,>(fn: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await fn();
    } catch {
      return fallback;
    }
  };

  const [totalScans, totalSavings, hourlyScans, maxMarkup, bustedRate, remaining] = await Promise.all([
    settle(getTotalScans, 0),
    settle(getTotalSavingsExposed, 0),
    settle(getHourlyScans, 0),
    // Never zero: the floor is the markup on the reference card rendered on
    // the same page, so the stat is always something a visitor can check.
    settle(getMaxMarkup, MARKUP_FLOOR),
    settle(getBustedRate, { total: 0, busted: 0 }),
    // For a paid account this is the fair-use headroom rather than the free
    // allowance. The landing page only renders it for non-paid visitors, so
    // it never reads as a limit on the unlimited tier; it is here so support
    // can answer "what does the server think this account has done today".
    settle(
      () => (isPaid ? paidScansRemaining(email) : freeScansRemaining(ip, browserId)),
      isPaid ? PAID_DAILY_SCAN_CEILING : FREE_SCANS_PER_DAY
    ),
  ]);

  return withBrowserCookie(NextResponse.json({
    isPaid,
    remaining,
    totalScans,
    totalSavings,
    hourlyScans,
    maxMarkup,
    verdictsRecorded: bustedRate.total,
    bustedRecorded: bustedRate.busted,
  }));
}

// ════════════════════════════════════════════════════════════════
// "This scan could not be completed" is its own answer, not a "no match".
//
// When a provider failed and the engine could not establish what the photo
// shows (see scan-trace.ts), the person is told to try again, and nothing
// about the attempt sticks: it does not use one of their free scans or count
// against fair use, it is not cached (a cached failure would answer their
// retry with the same failure for a day), and it never reaches the ledger.
// It IS counted, as scan_failed with the failing layer as its reason, so a
// provider outage shows up on the dashboard as what it is.
//
// 502 because the failure is upstream of this server. The browser does not
// report scan_failed for it again; the server already counted it.
// ════════════════════════════════════════════════════════════════
const INCOMPLETE_MESSAGE = "That scan could not be completed on our side. It did not use a free scan. Try again.";

async function incompleteScan(
  reason: FailureReason, layers: string[], issueBrowserId: boolean, extra: Record<string, unknown> = {}, counted = true
): Promise<NextResponse> {
  if (counted) await recordScanFailure(reason, layers);
  const response = NextResponse.json(
    { error: "scan_incomplete", reason, message: INCOMPLETE_MESSAGE, ...extra },
    { status: 502, headers: { "Cache-Control": "no-store" } }
  );
  if (issueBrowserId) {
    response.cookies.set("bl_bid", newBrowserId(), {
      maxAge: 60 * 60 * 24 * 30,
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
    });
  }
  return response;
}

// ════════════════════════════════════════════════════════════════
// THE OPERATOR EVALUATION PATH. A scan sent with the operator token and
// `x-bustedlab-eval: 1` is the same scan with three differences:
//   - the FREE allowance (per browser and per address) is neither checked
//     nor counted, because a labelled evaluation is many scans from one
//     machine;
//   - it never reaches public data: no ledger record (so no permanent page,
//     board entry, toast or "What we catch" record), no lifetime or hourly
//     scan counter, no verdict stats, no result cache entry a visitor could
//     be served, and no funnel event in /api/stats;
//   - the response carries the scan's full trace (every model call with its
//     tokens, cache reads and cost, every paid search, every gate decision,
//     time per layer).
// The burst limit, the global daily cap on uncached free scans and the
// counter behind it, and the model spend governor all apply exactly as they
// do to anyone else: an evaluation scan spends the same money. Every use is
// logged; see eval-log.ts. A browser never sends the token, so this never
// changes what a visitor gets. Records written before this rule are removed
// by POST /api/eval/purge.
// ════════════════════════════════════════════════════════════════

// POST — run scan
export async function POST(req: NextRequest) {
  const started = Date.now();
  const ip = getClientIp(req);
  const { email, isPaid } = await resolveAccess(req);
  const browserId = await getBrowserId(req);
  const evaluation = isEvaluationRequest(req);

  if (!(await withinBurstLimit(ip, browserId))) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }

  if (evaluation) {
    // No free-allowance check: see THE OPERATOR EVALUATION PATH above.
  } else if (!isPaid) {
    try {
      const remaining = await freeScansRemaining(ip, browserId);
      if (remaining <= 0) {
        return NextResponse.json({ error: "scan_limit_reached" }, { status: 429 });
      }
    } catch { /* Redis unreachable: fail open rather than block a real user */ }
  } else if (await paidScansRemaining(email) <= 0) {
    // Fair use on the unlimited tier. A DISTINCT error code, because the
    // client shows a paywall for every other 429 on this route, and putting
    // a purchase prompt in front of someone who has already paid is the
    // worst possible reading of a limit. See PAID_DAILY_SCAN_CEILING.
    return NextResponse.json(
      { error: "fair_use_ceiling", ceiling: PAID_DAILY_SCAN_CEILING },
      { status: 429, headers: { "Retry-After": "3600" } }
    );
  }

  try {
    const contentType = req.headers.get("content-type") || "";
    let result: ScanResult;
    let cacheKey: string | null = null;
    let servedFromCache = false;
    const country = req.headers.get("x-vercel-ip-country") || "us";

    // ── Resolve the input and its cache fingerprint ──
    let runScan: () => Promise<ScanResult>;
    let trace: ScanTrace | null = null;
    // Every scan's trace is kept: an evaluation scan returns it, and a
    // visitor's uncached scan is counted from it (what it cost, and the Lens
    // escalation; see recordScanCost in analytics.ts).
    const hooks = { onTrace: (t: ScanTrace) => { trace = t; } };
    let scannedIntent: string | undefined;

    if (contentType.includes("application/json")) {
      const { url, intent } = await req.json();
      if (!url || typeof url !== "string") {
        return NextResponse.json({ error: "URL required" }, { status: 400 });
      }
      const parsedIntent: "verdict" | "finder" | undefined = intent === "finder" ? "finder" : intent === "verdict" ? "verdict" : undefined;
      cacheKey = fingerprintUrl(url) + (parsedIntent ? `:${parsedIntent}` : "");
      scannedIntent = parsedIntent;
      runScan = () => scanProductUrl(url, country, parsedIntent, hooks);
    } else {
      const formData = await req.formData();
      const imageFile = formData.get("image") as File | null;
      if (!imageFile) return NextResponse.json({ error: "Image required" }, { status: 400 });
      if (imageFile.size > MAX_UPLOAD_BYTES) {
        return NextResponse.json({ error: "image_too_large" }, { status: 413 });
      }
      const rawIntent = formData.get("intent");
      const parsedIntent: "verdict" | "finder" | undefined = rawIntent === "finder" ? "finder" : rawIntent === "verdict" ? "verdict" : undefined;
      const bytes = Buffer.from(await imageFile.arrayBuffer());
      cacheKey = fingerprintImage(bytes) + (parsedIntent ? `:${parsedIntent}` : "");
      const base64 = bytes.toString("base64");
      const mimeType = imageFile.type || "image/jpeg";
      scannedIntent = parsedIntent;
      runScan = () => scanProduct(base64, mimeType, country, parsedIntent, hooks);
    }

    // ── Cache read. This is the layer that makes a viral moment survivable:
    //    the same product, or the same screenshot re-shared through a
    //    comment section, resolves to one cache entry and costs the API
    //    nothing on every hit after the first. ──
    const cached = cacheKey ? await getCachedScan<ScanResult>(cacheKey).catch(() => null) : null;

    if (cached) {
      servedFromCache = true;
      // The shipping disclosure depends on where THIS requester is, so it is
      // recomputed rather than served from another country's cache entry.
      // The proxied image path is re-signed for the same reason ledger
      // records are: an entry written before the current image-proxy secret
      // would otherwise come back with a signature the route now refuses.
      result = {
        ...cached,
        sourceProduct: {
          ...cached.sourceProduct,
          imageUrl: resignProxyPath(cached.sourceProduct?.imageUrl || ""),
        },
        shippingNote: buildShippingNote(cached.sourceProduct?.productUrl || "", country),
      };
    } else {
      // ── Global daily spend guard. Only uncached scans can reach the paid
      //    APIs, so only uncached scans count against the cap. ──
      if (!isPaid) {
        try {
          if (await getGlobalScansToday() >= GLOBAL_DAILY_CAP) {
            return NextResponse.json({ error: "high_demand" }, { status: 503 });
          }
        } catch { /* allow */ }
      }
      result = await runScan();
      if (result.failure) {
        if (evaluation) {
          const summary = trace ? summarizeTrace(trace) : null;
          await logEvaluationUse("scan", {
            intent: scannedIntent || null, outcome: "incomplete", reason: result.failure.reason,
            ms: Date.now() - started, claudeUsd: summary?.claudeUsd ?? null, searches: summary?.searchesByProvider ?? null,
          });
          return incompleteScan(result.failure.reason, result.failure.layers, !browserId, {
            evaluation: { failure: result.failure, trace: summary },
          }, false);
        }
        // What the failed scan still cost. Awaited like the failure count
        // below it (one pipelined write; it never throws).
        const failedTrace = trace as ScanTrace | null;
        if (failedTrace) await recordScanCost(scanCostFacts(failedTrace, false));
        return incompleteScan(result.failure.reason, result.failure.layers, !browserId);
      }
    }

    // ══════════════════════════════════════════════════════════════
    // THE LEDGER WRITE.
    //
    // Every verified verdict becomes a permanent record before the response
    // leaves. This is the one write on this route that is not a counter, and
    // it is the reason the company has an asset rather than a website.
    //
    // It is awaited rather than deferred to after(), because the scan id is
    // returned in this response and the person can open /scan/<id> the
    // instant they see it. One pipelined round trip is a price worth paying
    // to guarantee the page they were just handed a link to actually exists.
    // ══════════════════════════════════════════════════════════════
    let scanId: string | null = null;
    // Never for an evaluation scan: see THE OPERATOR EVALUATION PATH.
    if (!evaluation && result.mode === "VERDICT" && result.analysis.verdict !== "UNVERIFIED") {
      scanId = newScanId();
      const stored = await recordScan({
        id: scanId,
        ts: Date.now(),
        title: result.sourceProduct.title,
        category: result.category || "other",
        retailPrice: result.analysis.retailEstimate,
        wholesalePrice: result.sourceProduct.price,
        markup: result.analysis.markup,
        savings: result.analysis.savings,
        verdict: result.analysis.verdict as "HIGH_MARKUP" | "OVERPRICED" | "FAIR",
        confidence: result.analysis.confidence,
        matchConfidence: result.matchConfidence,
        platform: result.sourceProduct.platform,
        // The wholesale listing, never the retail URL the person scanned.
        // See the note on the ledger in src/lib/redis.ts.
        sourceUrl: result.sourceProduct.productUrl,
        imageUrl: result.sourceProduct.imageUrl,
        productKey: cacheKey || "",
        cached: servedFromCache,
        ...(result.analysis.retailOriginal ? { retailOriginal: result.analysis.retailOriginal } : {}),
      });
      // If the write failed, no permanent page exists, so no link is offered.
      // A share button pointing at a 404 is worse than no share button.
      if (!stored) scanId = null;
    }

    const summary = evaluation && trace ? summarizeTrace(trace) : null;
    if (evaluation) {
      await logEvaluationUse("scan", {
        intent: scannedIntent || null, outcome: result.mode, cached: servedFromCache, engineUsed: result.engineUsed,
        matchConfidence: result.matchConfidence, ms: Date.now() - started,
        claudeUsd: summary?.claudeUsd ?? 0, searches: summary?.searchesByProvider ?? {},
      });
    }

    // ── Counters. Deferred until after the response is sent: none of them
    //    affect what this person sees. See countCompletedScan. ──
    after(() => countCompletedScan({
      result, evaluation, isPaid, email, ip, browserId, servedFromCache, cacheKey, trace,
    }));
    const response = NextResponse.json({
      // The "Go to this price" link is the only thing an affiliate network
      // can wrap, and only here, on a result already decided, cached and
      // recorded with the direct link. Off unless AFFILIATE_PROVIDER and
      // AFFILIATE_KEY are set. See src/lib/affiliate.ts.
      ...withAffiliateLink(result),
      scanId,
      // What "Wrong product? Tell us" reports against: the ledger id when the
      // verdict has one, otherwise a fresh reference for this answer. Nothing
      // is stored under it unless a report arrives (/api/wrong-product).
      scanRef: scanId || newScanId(),
      ...(evaluation ? { evaluation: { cached: servedFromCache, ms: Date.now() - started, trace: summary } } : {}),
    });
    if (!browserId) {
      response.cookies.set("bl_bid", newBrowserId(), {
        maxAge: 60 * 60 * 24 * 30,
        httpOnly: true,
        sameSite: "lax",
        secure: true,
        path: "/",
      });
    }
    return response;
  } catch (err) {
    // An exception here is this server failing, not the product being
    // unfindable, so it gets the same answer as a provider failure.
    console.error("[scan] route error:", err);
    // An evaluation scan's failure is the runner's to report, not the
    // site's failure rate.
    return incompleteScan("engine", ["engine:route"], !browserId, {}, !evaluation);
  }
}

// PATCH — session check
export async function PATCH(req: NextRequest) {
  const { email, isPaid } = await resolveAccess(req);
  if (!email) return NextResponse.json({ authenticated: false });
  return NextResponse.json({ authenticated: true, email, paid: isPaid });
}
