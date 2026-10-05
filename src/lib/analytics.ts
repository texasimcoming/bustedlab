import { Redis } from "@upstash/redis";

/**
 * FIRST-PARTY ANALYTICS.
 *
 * A handful of events, counted in Redis, and nothing else. No PostHog, no Plausible, no
 * Google, no script tag, no cookie, no identifier of any kind. That is not
 * squeamishness: the privacy policy states that no third-party scripts run on
 * this site, and the moment a tag manager lands on the page that sentence
 * becomes false. This product's entire argument is that it tells you the truth
 * about what things cost. It cannot be running a surveillance stack behind the
 * page that says so.
 *
 * What is stored is a number per event per day. There is no session, no user,
 * no path, no referrer, no device, no country. A row here cannot be traced to
 * a person because it does not describe one: it says "on this date, this many
 * scans finished". That is enough to run the machine and it is the most that
 * can be collected without becoming the thing this product exists to expose.
 *
 * AUTHORITATIVE vs BEST-EFFORT. Some of these are counted on the server at
 * the moment the thing happens and cannot be forged from outside:
 * scan_completed, the verdict and result-type counters, and email_captured.
 * The rest are browser interactions and reach the server through a public
 * beacon, so they are rate limited but ultimately best-effort. The read
 * endpoint labels which is which, because a funnel that silently mixes a
 * number you can trust with one you cannot is worse than no funnel.
 *
 * THE FUNNEL, in the order a visitor meets it:
 *   landing_viewed      the landing page rendered in a browser running JS
 *   photo_selected /    the visitor gave it something to scan: a photo
 *   url_entered         picked or taken, or a link typed or pasted (once each
 *                       per page load, so fiddling with the field is one)
 *   scan_started        a scan request actually went out
 *   scan_completed      the server finished it (server-side), split into
 *                       verdict_* / result_finder / result_unresolved
 *   result_shown        the result screen rendered in the browser
 *   scan_failed         the scan did not complete. Either the browser gave
 *                       up (timeout, dropped connection), or the server could
 *                       not complete it because a provider failed; the server
 *                       counts those itself, with a reason (FAILURE_REASONS),
 *                       and the browser does not count them again
 *   card_saved          "Save to photos": for TikTok and Instagram, most
 *                       likely the way a card actually gets posted
 *   story_saved         the 9:16 Stories export
 *   share_tapped, paywall_shown, email_captured, checkout_clicked
 */

export const EVENTS = [
  "landing_viewed",
  "photo_selected",
  "url_entered",
  "scan_started",
  "scan_completed",
  "verdict_busted",
  "verdict_overpriced",
  "verdict_fair",
  "result_finder",
  "result_unresolved",
  "result_shown",
  "scan_failed",
  "card_saved",
  "story_saved",
  "share_tapped",
  "paywall_shown",
  "email_captured",
  "checkout_clicked",
] as const;

export type EventName = (typeof EVENTS)[number];

/** The events a browser is allowed to report. Everything else is server-side. */
export const CLIENT_EVENTS: readonly EventName[] = [
  "landing_viewed",
  "photo_selected",
  "url_entered",
  "scan_started",
  "result_shown",
  "scan_failed",
  "card_saved",
  "story_saved",
  "share_tapped",
  "paywall_shown",
  "checkout_clicked",
];

const EVENT_SET = new Set<string>(EVENTS);
const CLIENT_EVENT_SET = new Set<string>(CLIENT_EVENTS);

export function isEventName(value: unknown): value is EventName {
  return typeof value === "string" && EVENT_SET.has(value);
}

export function isClientReportable(value: unknown): value is EventName {
  return typeof value === "string" && CLIENT_EVENT_SET.has(value);
}

// Just over a year, so the same day last year is still there to compare
// against, and the keyspace still has a ceiling.
const DAY_TTL_SECONDS = 60 * 60 * 24 * 400;

let _redis: Redis | null = null;
function getRedis(): Redis {
  if (!_redis) {
    _redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL || "https://placeholder.upstash.io",
      token: process.env.UPSTASH_REDIS_REST_TOKEN || "placeholder",
    });
  }
  return _redis;
}

export function dayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

const keys = {
  day: (event: EventName, day: string) => `stat:${event}:${day}`,
  total: (event: EventName) => `stat:${event}:total`,
};

/**
 * Counts one or more events. Never throws and never blocks anything that
 * matters: an analytics write that fails is a number nobody sees, while an
 * analytics write that breaks a scan is a customer nobody keeps.
 *
 * Batched through a pipeline because these are almost always recorded in
 * groups (a finished scan is a scan_completed plus a verdict counter) and two
 * sequential round trips to count two integers is two too many.
 */
export async function recordEvents(events: EventName[], date = new Date()): Promise<void> {
  const valid = events.filter(isEventName);
  if (valid.length === 0) return;

  const day = dayKey(date);
  try {
    const pipeline = getRedis().pipeline();
    for (const event of valid) {
      pipeline.incr(keys.day(event, day));
      pipeline.expire(keys.day(event, day), DAY_TTL_SECONDS);
      pipeline.incr(keys.total(event));
    }
    await pipeline.exec();
  } catch {
    /* counting is never worth an error path */
  }
}

export async function recordEvent(event: EventName, date = new Date()): Promise<void> {
  return recordEvents([event], date);
}

/**
 * Why a scan could not be completed: the layer whose provider failed. A
 * fixed list, so a reason is a counter and never free text from an error.
 * Mirrors FailureLayer in scan-trace.ts.
 */
export const FAILURE_REASONS = [
  "extraction", "gate", "lens", "shopping", "upload", "text", "query", "retailer", "link", "fx", "engine",
] as const;
export type FailureReason = (typeof FAILURE_REASONS)[number];

const failureKeys = {
  day: (reason: FailureReason, day: string) => `stat:scan_failed:reason:${reason}:${day}`,
  total: (reason: FailureReason) => `stat:scan_failed:reason:${reason}:total`,
  recent: "stat:scan_failed:recent",
};
const RECENT_FAILURES_KEPT = 50;

/**
 * A scan the server could not complete: counted as scan_failed (the same
 * counter the browser uses for the scans it gives up on, so the failure rate
 * stays one number), plus a per-reason counter, plus the last fifty in a
 * short list for whoever is on call. The list holds the reason, the failed
 * layers as layer:provider:model:status, and the time. Nothing about the
 * person or the photo.
 */
export async function recordScanFailure(reason: FailureReason, layers: string[], date = new Date()): Promise<void> {
  const day = dayKey(date);
  const safeReason = (FAILURE_REASONS as readonly string[]).includes(reason) ? reason : "engine";
  try {
    const pipeline = getRedis().pipeline();
    pipeline.incr(keys.day("scan_failed", day));
    pipeline.expire(keys.day("scan_failed", day), DAY_TTL_SECONDS);
    pipeline.incr(keys.total("scan_failed"));
    pipeline.incr(failureKeys.day(safeReason, day));
    pipeline.expire(failureKeys.day(safeReason, day), DAY_TTL_SECONDS);
    pipeline.incr(failureKeys.total(safeReason));
    pipeline.lpush(failureKeys.recent, JSON.stringify({
      at: date.toISOString(), reason: safeReason, layers: layers.slice(0, 6).map(l => String(l).slice(0, 80)),
    }));
    pipeline.ltrim(failureKeys.recent, 0, RECENT_FAILURES_KEPT - 1);
    await pipeline.exec();
  } catch {
    /* counting is never worth an error path */
  }
}

export interface FailureBreakdown {
  byReason: { reason: FailureReason; windowTotal: number; total: number }[];
  recent: { at: string; reason: string; layers: string[] }[];
}

export async function readScanFailures(days = 30): Promise<FailureBreakdown> {
  const window = lastNDays(days);
  const redis = getRedis();
  try {
    const dayFields = FAILURE_REASONS.flatMap(r => window.map(d => failureKeys.day(r, d)));
    const [dayValues, totals, recent] = await Promise.all([
      redis.mget<(number | null)[]>(...dayFields),
      redis.mget<(number | null)[]>(...FAILURE_REASONS.map(r => failureKeys.total(r))),
      redis.lrange<unknown>(failureKeys.recent, 0, RECENT_FAILURES_KEPT - 1),
    ]);
    return {
      byReason: FAILURE_REASONS.map((reason, i) => ({
        reason,
        windowTotal: window.reduce((sum, _d, j) => sum + (Number(dayValues[i * window.length + j] ?? 0) || 0), 0),
        total: Number(totals[i] ?? 0) || 0,
      })),
      recent: (recent || []).map(entry => {
        try {
          return (typeof entry === "string" ? JSON.parse(entry) : entry) as FailureBreakdown["recent"][number];
        } catch {
          return { at: "", reason: "unreadable", layers: [] };
        }
      }),
    };
  } catch {
    return { byReason: FAILURE_REASONS.map(reason => ({ reason, windowTotal: 0, total: 0 })), recent: [] };
  }
}

// ════════════════════════════════════════════════════════════════
// "WRONG PRODUCT?" REPORTS. A person telling us the product we showed is not
// the one in their photo: a free ground-truth label for the identification
// engine. One report per scan (the first one counts), recorded as the scan's
// id, the result's mode and match confidence, and the time. Nothing about the
// person: the route's rate limit uses the same one-way hash of the address as
// every other limit, and that hash is not stored here. The list is bounded.
// ════════════════════════════════════════════════════════════════
export const REPORT_MODES = ["VERDICT", "FINDER", "UNRESOLVED"] as const;
export const REPORT_CONFIDENCES = ["exact", "likely", "unverified"] as const;
export type WrongProductReport = {
  scanId: string;
  mode: (typeof REPORT_MODES)[number];
  confidence: (typeof REPORT_CONFIDENCES)[number];
};
const WRONG_PRODUCT_KEPT = 500;
const wrongKeys = {
  seen: (scanId: string) => `wrong:seen:${scanId}`,
  day: (day: string) => `stat:wrong_product:${day}`,
  total: "stat:wrong_product:total",
  by: (mode: string, confidence: string) => `stat:wrong_product:by:${mode}:${confidence}`,
  recent: "stat:wrong_product:recent",
};
const WRONG_SEEN_SECONDS = 60 * 60 * 24 * 90;

/** Records a report unless this scan already has one. Returns whether it counted. Never throws. */
export async function recordWrongProduct(report: WrongProductReport, date = new Date()): Promise<boolean> {
  try {
    const redis = getRedis();
    const first = await redis.set(wrongKeys.seen(report.scanId), "1", { nx: true, ex: WRONG_SEEN_SECONDS });
    if (!first) return false;
    const day = dayKey(date);
    const pipeline = redis.pipeline();
    pipeline.incr(wrongKeys.day(day));
    pipeline.expire(wrongKeys.day(day), DAY_TTL_SECONDS);
    pipeline.incr(wrongKeys.total);
    pipeline.incr(wrongKeys.by(report.mode, report.confidence));
    pipeline.lpush(wrongKeys.recent, JSON.stringify({ ...report, at: date.toISOString() }));
    pipeline.ltrim(wrongKeys.recent, 0, WRONG_PRODUCT_KEPT - 1);
    await pipeline.exec();
    return true;
  } catch {
    return false;
  }
}

export interface WrongProductBreakdown {
  windowTotal: number;
  total: number;
  /** Lifetime, by "<mode> <confidence>", e.g. "FINDER exact". */
  byResult: Record<string, number>;
  recent: (WrongProductReport & { at: string })[];
}

export async function readWrongProduct(days = 30): Promise<WrongProductBreakdown> {
  const window = lastNDays(days);
  const combos = REPORT_MODES.flatMap(m => REPORT_CONFIDENCES.map(c => [m, c] as const));
  try {
    const redis = getRedis();
    const [dayValues, total, byValues, recent] = await Promise.all([
      redis.mget<(number | null)[]>(...window.map(d => wrongKeys.day(d))),
      redis.get<number | null>(wrongKeys.total),
      redis.mget<(number | null)[]>(...combos.map(([m, c]) => wrongKeys.by(m, c))),
      redis.lrange<unknown>(wrongKeys.recent, 0, 49),
    ]);
    const byResult: Record<string, number> = {};
    combos.forEach(([m, c], i) => { const n = Number(byValues[i] ?? 0) || 0; if (n) byResult[`${m} ${c}`] = n; });
    return {
      windowTotal: dayValues.reduce((sum: number, v) => sum + (Number(v ?? 0) || 0), 0),
      total: Number(total ?? 0) || 0,
      byResult,
      recent: (recent || []).map(e => (typeof e === "string" ? JSON.parse(e) : e) as WrongProductBreakdown["recent"][number]),
    };
  } catch {
    return { windowTotal: 0, total: 0, byResult: {}, recent: [] };
  }
}

// ════════════════════════════════════════════════════════════════
// WHAT A SCAN COST, AND THE LENS ESCALATION, PER UTC DAY.
//
// One hash a day, written once per uncached visitor scan from its trace
// (never for an evaluation scan or a cache hit): how many scans reached the
// engine, how many ended "Product not identified", whether SerpApi's Lens was
// asked after Serper's could not verify anything (see ESCALATION in
// src/lib/scan.ts) and how that ended, how many SerpApi searches the scan
// spent, and its Claude cost, split by escalated or not. Dollars are kept as
// whole micro-dollars so every write is an integer increment.
// ════════════════════════════════════════════════════════════════
export type EscalationOutcome = "none" | "rescued" | "nothing" | "skipped_reserve" | "skipped_time" | "skipped_other";

export interface ScanCostFacts {
  escalated: boolean;
  outcome: EscalationOutcome;
  serpapiSearches: number;
  claudeUsd: number;
  notIdentified: boolean;
}

const scanCostKey = (day: string) => `stat:scancost:${day}`;

/**
 * What one scan's trace says. Structural types only, so this file still
 * imports nothing from the engine. "rescued" means the escalation turned a
 * scan with no match into an exact or likely one; a skip is the reason it did
 * not run (SerpApi at its reserve or balance unknown, too little time left,
 * or another: a degraded day, no key, the upload failing).
 */
export function scanCostFacts(
  trace: { steps: { step: string; [field: string]: unknown }[]; calls: { costUsd?: number }[]; searches: { provider: string }[] },
  notIdentified: boolean
): ScanCostFacts {
  const steps = trace.steps.filter(s => s.step === "escalation");
  const ran = steps.find(s => s.ran === true);
  const skipped = steps.find(s => s.ran === false);
  const outcome: EscalationOutcome = ran
    ? (ran.confidence === "exact" || ran.confidence === "likely" ? "rescued" : "nothing")
    : skipped
      ? (skipped.skip === "reserve" ? "skipped_reserve" : skipped.skip === "time" ? "skipped_time" : "skipped_other")
      : "none";
  return {
    escalated: !!ran,
    outcome,
    serpapiSearches: trace.searches.filter(s => s.provider === "serpapi").length,
    claudeUsd: trace.calls.reduce((sum, c) => sum + (Number(c.costUsd) || 0), 0),
    notIdentified,
  };
}

/** Counts one uncached visitor scan. Never throws. */
export async function recordScanCost(facts: ScanCostFacts, date = new Date()): Promise<void> {
  try {
    const key = scanCostKey(dayKey(date));
    const micro = Math.max(0, Math.round(facts.claudeUsd * 1_000_000));
    const pipeline = getRedis().pipeline();
    pipeline.hincrby(key, "scans", 1);
    if (facts.notIdentified) pipeline.hincrby(key, "not_identified", 1);
    if (facts.outcome !== "none") pipeline.hincrby(key, `esc_${facts.outcome}`, 1);
    if (facts.escalated) pipeline.hincrby(key, "esc_fired", 1);
    if (facts.serpapiSearches > 0) pipeline.hincrby(key, "serpapi_searches", facts.serpapiSearches);
    pipeline.hincrby(key, facts.escalated ? "scans_escalated" : "scans_plain", 1);
    if (micro > 0) pipeline.hincrby(key, facts.escalated ? "micro_usd_escalated" : "micro_usd_plain", micro);
    pipeline.expire(key, DAY_TTL_SECONDS);
    await pipeline.exec();
  } catch {
    /* a counter that fails is a number nobody sees */
  }
}

export interface ScanCostDay {
  day: string;
  /** Uncached visitor scans that reached the engine. */
  scans: number;
  notIdentified: number;
  escalation: { fired: number; rescued: number; nothing: number; skippedReserve: number; skippedTime: number; skippedOther: number };
  serpapiSearches: number;
  claude: {
    escalated: { scans: number; usd: number; perScanUsd: number | null };
    plain: { scans: number; usd: number; perScanUsd: number | null };
  };
}

function scanCostDay(day: string, h: Record<string, unknown> | null): ScanCostDay {
  const n = (field: string) => Number(h?.[field] ?? 0) || 0;
  const usd = (field: string) => n(field) / 1_000_000;
  const side = (scans: number, total: number) => ({
    scans, usd: Math.round(total * 1_000_000) / 1_000_000,
    perScanUsd: scans > 0 ? Math.round((total / scans) * 10_000) / 10_000 : null,
  });
  return {
    day,
    scans: n("scans"),
    notIdentified: n("not_identified"),
    escalation: {
      fired: n("esc_fired"), rescued: n("esc_rescued"), nothing: n("esc_nothing"),
      skippedReserve: n("esc_skipped_reserve"), skippedTime: n("esc_skipped_time"), skippedOther: n("esc_skipped_other"),
    },
    serpapiSearches: n("serpapi_searches"),
    claude: {
      escalated: side(n("scans_escalated"), usd("micro_usd_escalated")),
      plain: side(n("scans_plain"), usd("micro_usd_plain")),
    },
  };
}

/** The last `days` UTC days, oldest first, and their total under day "window". */
export async function readScanCosts(days = 30): Promise<{ days: ScanCostDay[]; window: ScanCostDay }> {
  const window = lastNDays(days);
  let hashes: (Record<string, unknown> | null)[] = window.map(() => null);
  try {
    const pipeline = getRedis().pipeline();
    for (const d of window) pipeline.hgetall(scanCostKey(d));
    hashes = (await pipeline.exec()) as (Record<string, unknown> | null)[];
  } catch {
    /* empty days */
  }
  const perDay = window.map((d, i) => scanCostDay(d, hashes[i]));
  const sum: Record<string, number> = {};
  for (const h of hashes) for (const [k, v] of Object.entries(h || {})) sum[k] = (sum[k] || 0) + (Number(v) || 0);
  return { days: perDay, window: scanCostDay("window", sum) };
}

export interface EventSeries {
  event: EventName;
  total: number;
  days: { day: string; count: number }[];
  windowTotal: number;
}

function lastNDays(n: number): string[] {
  const out: string[] = [];
  const now = Date.now();
  for (let i = n - 1; i >= 0; i--) {
    out.push(dayKey(new Date(now - i * 86400000)));
  }
  return out;
}

/**
 * Reads the whole board in two round trips regardless of the window: one MGET
 * for every day of every event, one for the lifetime totals. A day-by-day loop
 * would be events x days round trips, which for a 30-day window is hundreds
 * of requests to render one page.
 */
export async function readEvents(days = 30): Promise<EventSeries[]> {
  const window = lastNDays(days);
  const redis = getRedis();

  const dayFields: string[] = [];
  for (const event of EVENTS) {
    for (const day of window) dayFields.push(keys.day(event, day));
  }

  let dayValues: (number | null)[] = [];
  let totals: (number | null)[] = [];
  try {
    [dayValues, totals] = await Promise.all([
      redis.mget<(number | null)[]>(...dayFields),
      redis.mget<(number | null)[]>(...EVENTS.map(e => keys.total(e))),
    ]);
  } catch {
    dayValues = [];
    totals = [];
  }

  return EVENTS.map((event, eventIndex) => {
    const slice = window.map((day, dayIndex) => ({
      day,
      count: Number(dayValues[eventIndex * window.length + dayIndex] ?? 0) || 0,
    }));
    return {
      event,
      total: Number(totals[eventIndex] ?? 0) || 0,
      days: slice,
      windowTotal: slice.reduce((a, b) => a + b.count, 0),
    };
  });
}

export interface Funnel {
  landings: number;
  inputs: { photo: number; url: number };
  /** Landings where the visitor gave it something to scan. */
  inputRate: number | null;
  scanStarts: number;
  /** Landings that started a scan: the number the first screen exists for. */
  scanStartRate: number | null;
  scans: number;
  results: { verdict: number; finder: number; unresolved: number };
  /** Completed scans that found nothing to show. */
  unresolvedRate: number | null;
  resultsShown: number;
  scanFailures: number;
  /** Started scans the browser gave up on (timeout, dropped connection). */
  scanFailureRate: number | null;
  verdicts: { busted: number; overpriced: number; fair: number };
  bustedRate: number | null;
  shares: number;
  sharesPerScan: number | null;
  saves: number;
  /** "Save to photos" taps per completed scan. */
  savesPerScan: number | null;
  storySaves: number;
  /** Stories exports per completed scan. */
  storySavesPerScan: number | null;
  paywalls: number;
  paywallRate: number | null;
  emails: number;
  emailCaptureRate: number | null;
  checkoutClicks: number;
  checkoutClickRate: number | null;
}

const pct = (numerator: number, denominator: number): number | null =>
  denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : null;

/**
 * The only ratios worth looking at, computed rather than eyeballed.
 *
 * sharesPerScan is the one that decides whether this reaches 750 million
 * people or 750 thousand. It is the loop coefficient: every share is an
 * impression that produces some fraction of a new scan, so the whole growth
 * model is a function of this number and nothing else. It was unmeasured until
 * now, which meant every decision about the card, the tone and the permanent
 * page was being made blind.
 */
export function buildFunnel(series: EventSeries[], scope: "window" | "total" = "window"): Funnel {
  const get = (event: EventName) => {
    const found = series.find(s => s.event === event);
    if (!found) return 0;
    return scope === "total" ? found.total : found.windowTotal;
  };

  const landings = get("landing_viewed");
  const photo = get("photo_selected");
  const url = get("url_entered");
  const scanStarts = get("scan_started");
  const finder = get("result_finder");
  const unresolved = get("result_unresolved");
  const resultsShown = get("result_shown");
  const scanFailures = get("scan_failed");
  const scans = get("scan_completed");
  const busted = get("verdict_busted");
  const overpriced = get("verdict_overpriced");
  const fair = get("verdict_fair");
  const verdictTotal = busted + overpriced + fair;
  const shares = get("share_tapped");
  const saves = get("card_saved");
  const storySaves = get("story_saved");
  const paywalls = get("paywall_shown");
  const emails = get("email_captured");
  const checkoutClicks = get("checkout_clicked");

  return {
    landings,
    inputs: { photo, url },
    // A visitor can do both, so this can overstate slightly; it is a rate of
    // input events per landing, not of distinct visitors.
    inputRate: pct(photo + url, landings),
    scanStarts,
    scanStartRate: pct(scanStarts, landings),
    scans,
    results: { verdict: verdictTotal, finder, unresolved },
    unresolvedRate: pct(unresolved, scans),
    resultsShown,
    scanFailures,
    scanFailureRate: pct(scanFailures, scanStarts),
    verdicts: { busted, overpriced, fair },
    bustedRate: pct(busted, verdictTotal),
    shares,
    // Deliberately not a percentage. A loop coefficient above 1 is the whole
    // point and a "percentage" that can exceed 100 reads as a bug.
    sharesPerScan: scans > 0 ? Math.round((shares / scans) * 1000) / 1000 : null,
    saves,
    savesPerScan: scans > 0 ? Math.round((saves / scans) * 1000) / 1000 : null,
    storySaves,
    storySavesPerScan: scans > 0 ? Math.round((storySaves / scans) * 1000) / 1000 : null,
    paywalls,
    paywallRate: pct(paywalls, scans),
    emails,
    emailCaptureRate: pct(emails, paywalls),
    checkoutClicks,
    checkoutClickRate: pct(checkoutClicks, paywalls),
  };
}
