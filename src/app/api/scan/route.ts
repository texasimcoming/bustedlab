import { NextRequest, NextResponse } from "next/server";
import { scanProduct, scanProductUrl, getUnresolvedResult, buildShippingNote, type ScanResult } from "@/lib/scan";
import {
  getScansRemaining,
  incrementScanCount,
  incrementTotalScans,
  getTotalScans,
  incrementTotalSavings,
  getTotalSavingsExposed,
  incrementHourlyScans,
  getHourlyScans,
  isPaidUser,
  getSessionEmail,
  getGlobalScansToday,
  incrementGlobalScans,
  GLOBAL_DAILY_CAP,
  FREE_SCANS_PER_DAY,
  getCachedScan,
  setCachedScan,
  fingerprintUrl,
  fingerprintImage,
  recordMarkup,
  recordVerdict,
  getMaxMarkup,
  getBustedRate,
  MARKUP_FLOOR,
  recordScan,
  newScanId,
} from "@/lib/redis";
import { cookies } from "next/headers";
import { after } from "next/server";
import { recordEvents, type EventName } from "@/lib/analytics";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import crypto from "crypto";

// Vision extraction (~2-8s) + Lens/Shopping search (~2-14s) + parallel
// verification (~2-10s) can add up past Vercel's default function
// duration. This requires a plan that supports the value below —
// confirm your Vercel plan's max before relying on it; Hobby plans cap
// lower than Pro. If scans are timing out in production, check this first.
export const maxDuration = 60;

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
// ════════════════════════════════════════════════════════════════
const BURST_LIMIT = Number(process.env.SCAN_BURST_PER_MINUTE || 12);

let _limiter: Ratelimit | null | undefined;
function getLimiter(): Ratelimit | null {
  if (_limiter !== undefined) return _limiter;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  _limiter = url && token
    ? new Ratelimit({
        redis: new Redis({ url, token }),
        limiter: Ratelimit.slidingWindow(BURST_LIMIT, "60 s"),
        prefix: "scan:burst",
        analytics: false,
      })
    : null;
  return _limiter;
}

async function withinBurstLimit(identifier: string): Promise<boolean> {
  const limiter = getLimiter();
  if (!limiter) return true;
  try {
    const { success } = await limiter.limit(identifier);
    return success;
  } catch {
    return true;
  }
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
async function getBrowserId(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get("bl_bid")?.value || null;
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
async function resolveAccess(): Promise<{ email: string | null; isPaid: boolean }> {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get("bl_session")?.value;
  if (!sessionToken) return { email: null, isPaid: false };
  try {
    const email = await getSessionEmail(sessionToken);
    if (!email) return { email: null, isPaid: false };
    return { email, isPaid: await isPaidUser(email) };
  } catch {
    return { email: null, isPaid: false };
  }
}

// Free allowance is the stricter of the two limits. Both were previously
// being written, but only the IP side was ever read, so the browser counter
// was pure write traffic that enforced nothing.
async function getFreeScansRemaining(ip: string, browserId: string | null): Promise<number> {
  const checks = [getScansRemaining(ip)];
  if (browserId) checks.push(getScansRemaining(`browser:${browserId}`));
  const results = await Promise.all(checks);
  return Math.min(...results);
}

// GET — free-tier state plus the real public counters behind the landing page
export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  const browserId = await getBrowserId();
  const { isPaid } = await resolveAccess();

  const withBrowserCookie = (res: NextResponse) => {
    // Issued on the first page load rather than on the first scan, so the
    // limit is already anchored to a browser before any API spend happens.
    if (!browserId) {
      res.cookies.set("bl_bid", newBrowserId(), {
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
    settle(
      () => (isPaid ? Promise.resolve(FREE_SCANS_PER_DAY) : getFreeScansRemaining(ip, browserId)),
      FREE_SCANS_PER_DAY
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

// POST — run scan
export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const { isPaid } = await resolveAccess();
  const browserId = await getBrowserId();

  if (!(await withinBurstLimit(ip))) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }

  if (!isPaid) {
    try {
      const remaining = await getFreeScansRemaining(ip, browserId);
      if (remaining <= 0) {
        return NextResponse.json({ error: "scan_limit_reached" }, { status: 429 });
      }
    } catch { /* Redis unreachable: fail open rather than block a real user */ }
  }

  try {
    const contentType = req.headers.get("content-type") || "";
    let result: ScanResult;
    let cacheKey: string | null = null;
    let servedFromCache = false;
    const country = req.headers.get("x-vercel-ip-country") || "us";

    // ── Resolve the input and its cache fingerprint ──
    let runScan: () => Promise<ScanResult>;

    if (contentType.includes("application/json")) {
      const { url } = await req.json();
      if (!url || typeof url !== "string") {
        return NextResponse.json({ error: "URL required" }, { status: 400 });
      }
      cacheKey = fingerprintUrl(url);
      runScan = () => scanProductUrl(url, country);
    } else {
      const formData = await req.formData();
      const imageFile = formData.get("image") as File | null;
      if (!imageFile) return NextResponse.json({ error: "Image required" }, { status: 400 });
      if (imageFile.size > MAX_UPLOAD_BYTES) {
        return NextResponse.json({ error: "image_too_large" }, { status: 413 });
      }
      const bytes = Buffer.from(await imageFile.arrayBuffer());
      cacheKey = fingerprintImage(bytes);
      const base64 = bytes.toString("base64");
      const mimeType = imageFile.type || "image/jpeg";
      runScan = () => scanProduct(base64, mimeType, country);
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
      result = {
        ...cached,
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
    if (result.mode === "VERDICT" && result.analysis.verdict !== "UNVERIFIED") {
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
      });
      // If the write failed, no permanent page exists, so no link is offered.
      // A share button pointing at a 404 is worse than no share button.
      if (!stored) scanId = null;
    }

    // ── Counters. Deferred until after the response is sent: none of them
    //    affect what this person sees, and six sequential Redis round trips
    //    were previously sitting between the finished scan and the render. ──
    const wasFirstMeasurement = !servedFromCache && result.mode === "VERDICT";
    const verdictIsBusted = result.analysis.verdict === "HIGH_MARKUP";
    const savings = result.analysis.savings;
    const markup = result.analysis.markup;

    after(async () => {
      // A cache hit still consumes a free scan: otherwise the same product
      // could be rescanned forever for free.
      if (!isPaid) {
        await incrementScanCount(ip).catch(() => {});
        if (browserId) await incrementScanCount(`browser:${browserId}`).catch(() => {});
        if (!servedFromCache) await incrementGlobalScans().catch(() => {});
      }
      await incrementTotalScans().catch(() => {});
      await incrementHourlyScans().catch(() => {});

      // Only a genuine, visually verified VERDICT carries a real dollar
      // amount worth accumulating. Cache hits are excluded so one viral
      // product cannot inflate the lifetime totals by the number of people
      // who looked at it.
      if (wasFirstMeasurement) {
        await recordVerdict(verdictIsBusted).catch(() => {});
        if (savings > 0) await incrementTotalSavings(savings).catch(() => {});
        if (markup > 0) await recordMarkup(markup).catch(() => {});
      }

      // ── Cache write. Only real, verified results are worth keeping:
      //    caching an UNRESOLVED would pin a failure in place for 24 hours,
      //    including for the retry the person is about to make. ──
      if (cacheKey && !servedFromCache && result.found && result.mode === "VERDICT") {
        const { shippingNote, ...cacheable } = result;
        void shippingNote;
        await setCachedScan(cacheKey, cacheable).catch(() => {});
      }

      // ── Analytics. Counted here rather than from the browser because this
      //    is the moment the scan actually finished, which makes these two
      //    numbers unforgeable. Every completed scan counts, including cache
      //    hits and failures: "how many scans happened" is a different
      //    question from "how many produced a verdict", and conflating them
      //    hides exactly the failure rate worth watching. ──
      const events: EventName[] = ["scan_completed"];
      if (result.mode === "VERDICT") {
        if (result.analysis.verdict === "HIGH_MARKUP") events.push("verdict_busted");
        else if (result.analysis.verdict === "OVERPRICED") events.push("verdict_overpriced");
        else if (result.analysis.verdict === "FAIR") events.push("verdict_fair");
      }
      await recordEvents(events);
    });

    const response = NextResponse.json({ ...result, scanId });
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
    console.error("Scan error:", err);
    return NextResponse.json(getUnresolvedResult());
  }
}

// PATCH — session check
export async function PATCH() {
  const { email, isPaid } = await resolveAccess();
  if (!email) return NextResponse.json({ authenticated: false });
  return NextResponse.json({ authenticated: true, email, paid: isPaid });
}
